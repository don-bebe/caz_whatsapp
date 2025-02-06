require("dotenv").config();
const express = require("express");
const axios = require("axios");
const dialogflow = require("@google-cloud/dialogflow");
const stringSimilarity = require("string-similarity");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.APP_PORT || 5000;

app.use(express.json());

const CREDENTIALS_PATH = path.join(__dirname, "dialogflow-credentials.json");
const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));

const WELCOME_MESSAGES_PATH = path.join(__dirname, "welcome-messages.json");
const welcomeMessages = JSON.parse(
  fs.readFileSync(WELCOME_MESSAGES_PATH, "utf-8")
).welcomeMessages;

const sessionClient = new dialogflow.SessionsClient({ credentials });

const userSessions = {};

const MENU_OPTIONS = {
  1: {
    name: "Learn about Cancer",
    submenu: {
      1: "Breast Cancer",
      2: "HIV & AIDS Cancer",
      3: "Cancer in Children",
    },
  },
  2: {
    name: "CAZ Services",
    submenu: { 1: "Breast Care", 2: "Emotional Support", 3: "Support Groups" },
  },
  3: { name: "Care Services", submenu: null },
  4: { name: "About Us", submenu: null },
};

app.get("/whatsapp/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (
    mode === "subscribe" &&
    token === process.env.WHATSAPP_CLOUD_API_VERIFICATION
  ) {
    console.log("Webhook Verified");
    return res.send(challenge);
  }
  return res.status(403).send("Verification Failed");
});

app.post("/whatsapp/webhook", async (req, res) => {
  try {
    const message = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message) return res.sendStatus(200);

    const sender = message.from;
    const text = message.text?.body.trim().toLowerCase();

    if (!userSessions[sender]) {
      userSessions[sender] = { lastMenu: null };
    }

    const exactMatch = welcomeMessages.some((msg) =>
      new RegExp(`\\b${msg}\\b`, "i").test(text)
    );
    const bestMatch = stringSimilarity.findBestMatch(
      text,
      welcomeMessages
    ).bestMatch;
    const fuzzyMatch = bestMatch.rating > 0.7;

    if (exactMatch || fuzzyMatch) {
      await sendWhatsAppImage(
        sender,
        "https://drive.google.com/file/d/1fBmQhx4UH7V36v5kbhNJbM7yuMc-ExNs/view?usp=drive_link",
        ""
      );
      await sendWhatsAppMessage(
        sender,
        `🌟 *Welcome to the Cancer Association of Zimbabwe Chatbot!* 🌟\n\n` +
          `How can we assist you today? Reply with a number:\n\n${generateMenu()}`
      );

      userSessions[sender].lastMenu = null;
    }

    if (userSessions[sender].lastMenu === null && isNaN(text)) {
      const aiResponse = await generateDialogflowResponse(text, sender);
      await sendWhatsAppMessage(sender, aiResponse);
    }

    let selectedOption;
    selectedOption = MENU_OPTIONS[text];
    if (!selectedOption) {
      await sendWhatsAppMessage(
        sender,
        "Invalid option. Please select a valid number:\n\n" + generateMenu()
      );
    }

    if (MENU_OPTIONS[text]) {
      userSessions[sender].lastMenu = text;
      userSessions[sender].lastSubmenu = null;
      userSessions[sender].isSelectingSubmenu = true;
      if (selectedOption.submenu) {
        await sendWhatsAppMessage(
          sender,
          `You selected: *${
            selectedOption.name
          }*\n\nPlease choose a topic:\n\n${generateSubMenu(
            selectedOption.submenu
          )}`
        );
      } else {
        const aiResponse = await generateDialogflowResponse(
          selectedOption.name,
          sender
        );
        await sendWhatsAppMessage(sender, aiResponse);
        await sendWhatsAppMessage(
          sender,
          `Would you like to know more about *${selectedOption.name}*? (Yes/No)`
        );
        userSessions[sender].expectingFollowUp = true;
      }
      return res.sendStatus(200);
    }

    if (
      userSessions[sender].expectingFollowUp &&
      (text === "yes" ||
        text === "Yes" ||
        text === "YES" ||
        text === "Y" ||
        text === "y")
    ) {
      const lastTopic = MENU_OPTIONS[userSessions[sender].lastMenu]?.name;
      if (lastTopic && userSessions[sender].lastResponse) {
        const aiResponse = await generateDialogflowResponse(
          lastTopic + " advanced",
          sender
        );
        await sendWhatsAppMessage(sender, aiResponse);
        userSessions[sender].lastResponse = aiResponse;
      }
      return res.sendStatus(200);
    }

    if (
      userSessions[sender].expectingFollowUp &&
      (text === "no" ||
        text === "No" ||
        text === "NO" ||
        text === "n" ||
        text === "N")
    ) {
      await sendWhatsAppMessage(
        sender,
        `Alright! Here’s the main menu again:\n\n${generateMenu()}`
      );
      userSessions[sender].expectingFollowUp = false;
      return res.sendStatus(200);
    }

    if (userSessions[sender].isSelectingSubmenu) {
      const lastMenu = userSessions[sender].lastMenu;
      const selectedSubmenu = MENU_OPTIONS[lastMenu].submenu[text];

      if (selectedSubmenu) {
        userSessions[sender].isSelectingSubmenu = false;
        await sendWhatsAppMessage(
          sender,
          `You selected: *${selectedSubmenu}*\n\nWhat do you want to know about *${selectedSubmenu}*?`
        );
        // const aiResponse = await generateDialogflowResponse(
        //   selectedSubmenu,
        //   sender
        // );
        // await sendWhatsAppMessage(sender, aiResponse);
      } else {
        await sendWhatsAppMessage(
          sender,
          "Invalid submenu option. Please select a valid option."
        );
      }
      return res.sendStatus(200);
    }

    if (userSessions[sender].lastSubmenu) {
      const aiResponse = await generateDialogflowResponse(text, sender);
      await sendWhatsAppMessage(sender, aiResponse);
      return res.sendStatus(200);
    }

    const aiResponse = await generateDialogflowResponse(text, sender);
    if (aiResponse.includes("sorry")) {
      await sendWhatsAppMessage(
        sender,
        `I'm not sure about that. Please choose from the menu below:\n\n${generateMenu()}`
      );
    } else {
      await sendWhatsAppMessage(sender, aiResponse);
    }
  } catch (error) {
    console.error("Error in webhook handler:", error);
    res.status(500).send("Internal Server Error");
  }
});

async function generateDialogflowResponse(userInput, sessionId) {
  try {
    const sessionPath = sessionClient.projectAgentSessionPath(
      credentials.project_id,
      sessionId
    );

    const request = {
      session: sessionPath,
      queryInput: {
        text: {
          text: userInput,
          languageCode: "en",
        },
      },
    };

    const generalResponses = await sessionClient.detectIntent(request);
    return (
      generalResponses[0]?.queryResult?.fulfillmentText ||
      "Sorry, I couldn't find anything related to that."
    );
  } catch (error) {
    console.error("Dialogflow Error:", error.message);
    return "Sorry, I am unable to respond at the moment.";
  }
}

async function sendWhatsAppImage(to, imageUrl, caption) {
  const url = `https://graph.facebook.com/${process.env.WHATSAPP_CLOUD_VERSION}/${process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID}/messages`;
  const data = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "image",
    image: { link: imageUrl, caption },
  };

  try {
    const response = await axios.post(url, data, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.WHATSAPP_CLOUD_ACCESS_TOKEN}`,
      },
    });
    console.log("Image sent:", response.data);
  } catch (error) {
    console.error("WhatsApp API Error:", error.response?.data || error.message);
  }
}

async function sendWhatsAppMessage(to, message) {
  const url = `https://graph.facebook.com/${process.env.WHATSAPP_CLOUD_VERSION}/${process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID}/messages`;

  const data = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { body: message },
  };

  try {
    const response = await axios.post(url, data, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.WHATSAPP_CLOUD_ACCESS_TOKEN}`,
      },
    });
    console.log("Message sent:", response.data);
  } catch (error) {
    console.error(
      "WhatsApp API Error (sendWhatsAppMessage):",
      error.response?.status,
      error.response?.data || error.message,
      "Request:",
      data
    );
    await sendWhatsAppMessage(
      to,
      "Sorry, something went wrong. Please try again later. (Error Code: " +
        error.response?.status || "Unknown"
    );
    throw error;
  }
}

function generateMenu() {
  return Object.entries(MENU_OPTIONS)
    .map(([key, option]) => `${key}. ${option.name}`)
    .join("\n");
}

function generateSubMenu(submenu) {
  let menuString = "";
  let counter = "a"; // Start with 'a'
  for (const key in submenu) {
    menuString += `${counter}. ${submenu[key]}\n`;
    counter = String.fromCharCode(counter.charCodeAt(0) + 1); // Increment letter
  }
  return menuString;
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
