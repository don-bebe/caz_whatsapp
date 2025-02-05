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
        "https://cancerzimbabwe.org/images/logo.png",
        ""
      );
      await sendWhatsAppMessage(
        sender,
        `🌟 *Welcome to the Cancer Association of Zimbabwe Chatbot!* 🌟\n\nHow can we assist you today? Reply with a number:\n\n${generateMenu()}`
      );
      return res.sendStatus(200);
    }
    const mainMenuSelection = MENU_OPTIONS[text];
    if (mainMenuSelection) {
      if (mainMenuSelection.submenu) {
        await sendWhatsAppMessage(
          sender,
          `You selected: *${
            mainMenuSelection.name
          }*\n\nPlease choose a topic:\n\n${generateSubMenu(
            mainMenuSelection.submenu
          )}`
        );
      } else {
        await sendWhatsAppMessage(
          sender,
          `You selected: *${mainMenuSelection.name}*\n\nHow can we assist you further?`
        );
      }
      return res.sendStatus(200);
    }
    let foundSubmenu = null;
    let submenuName = "";

    for (const key in MENU_OPTIONS) {
      if (MENU_OPTIONS[key].submenu && MENU_OPTIONS[key].submenu[text]) {
        foundSubmenu = MENU_OPTIONS[key].submenu[text];
        submenuName = foundSubmenu;
        break;
      }
    }
    if (foundSubmenu) {
      await sendWhatsAppMessage(
        sender,
        `You selected: *${submenuName}*\n\nWhat do you want to know about *${submenuName}*?`
      );
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
    console.error("Error handling message:", error.message);
  }

  res.sendStatus(200);
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
    console.error("WhatsApp API Error:", error.response?.data || error.message);
  }
}

function generateMenu() {
  return Object.entries(MENU_OPTIONS)
    .map(([key, option]) => `${key}. ${option.name}`)
    .join("\n");
}

function generateSubMenu(submenu) {
  return Object.entries(submenu)
    .map(([key, value]) => `${key}. ${value}`)
    .join("\n");
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
