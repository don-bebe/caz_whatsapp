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
    name: "Make an appointment",
    submenu: { submenu: null },
  },
  2: {
    name: "View appointment",
    submenu: {
      a: "Upcoming Appointments",
      b: "Appointment Details",
      c: "Cancel/Reschedule Appointment",
    },
  },
  3: {
    name: "Learn about Cancer",
    submenu: {
      a: "Breast Cancer",
      b: "HIV & AIDS Cancer",
      c: "Cancer in Children",
      d: "Cervical Cancer",
    },
  },
  4: { name: "Care Services", submenu: null },
  5: { name: "About Us", submenu: null },
};

const SERVICE_OPTIONS = {
  1: { name: "Consultation" },
  2: { name: "Screening and diagnostic tests" },
  3: { name: "Treatment" },
  4: { name: "Supportive care services" },
};

const userContext = {};

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

    const currentContext = userContext[sender];

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

    handleAppointmentBooking(sender, text);

    if (currentContext && currentContext.submenu) {
      const selectedSubOptionKey = text;
      const selectedSubOption = currentContext.submenu[selectedSubOptionKey];
      if (selectedSubOption) {
        await sendWhatsAppMessage(
          sender,
          `What do you want to know about *${selectedSubOption}*?`
        );
        delete userContext[sender];
      } else {
        await sendWhatsAppMessage(
          sender,
          "Invalid submenu option.\nPlease choose from the list below:\n\n" +
            generateSubMenu(currentContext.submenu)
        );
      }
      return res.sendStatus(200);
    }

    if (MENU_OPTIONS[text]) {
      const selectedOption = MENU_OPTIONS[text];
      if (selectedOption.submenu) {
        userContext[sender] = selectedOption;
        await sendWhatsAppMessage(
          sender,
          `You selected: *${
            selectedOption.name
          }*\n\nPlease choose a topic:\n\n${generateSubMenu(
            selectedOption.submenu
          )}`
        );
      } else {
        userContext[sender] = selectedOption;
        await sendWhatsAppMessage(
          sender,
          `You selected: *${selectedOption.name}*\n\nYou can now type your question about ${selectedOption.name}.`
        );
      }
    } else if (currentContext && !currentContext.submenu) {
      const aiResponse = await generateDialogflowResponse(text, sender);
      await sendWhatsAppMessage(sender, aiResponse);
    } else {
      const aiResponse = await generateDialogflowResponse(text, sender);
      if (aiResponse.includes("Sorry")) {
        await sendWhatsAppMessage(
          sender,
          `I'm not sure about that. Please choose from the menu below:\n\n${generateMenu()}`
        );
      } else {
        await sendWhatsAppMessage(sender, aiResponse);
      }
    }
  } catch (error) {
    console.error("Error handling message:", error.message);
  }

  res.sendStatus(200);
});

async function handleAppointmentBooking(sender, text) {
  const currentContext = userContext[sender];
  if (text === "1" && !currentContext) {
    userContext[sender] = { step: "selectService" };
    return await sendWhatsAppMessage(
      sender,
      `🗓️ *Appointment Booking* Please select a service:\n ${generateServiceMenu()} (Reply with the number of your choice)`
    );
  }

  if (currentContext?.step === "selectService") {
    if (SERVICE_OPTIONS[text]) {
      userContext[sender] = {
        step: "enterName",
        service: SERVICE_OPTIONS[text].name,
      };
      return await sendWhatsAppMessage(
        sender,
        `✅ You have selected *${SERVICE_OPTIONS[text].name}*. \nPlease enter your full name:`
      );
    } else {
      return await sendWhatsAppMessage(
        sender,
        `❌ Invalid selection. Please choose a valid service:\n${generateServiceMenu()}`
      );
    }
  }

  if (currentContext?.step === "enterName") {
    userContext[sender] = {
      step: "selectGender",
      service: currentContext.service,
      name: text,
    };
    return await sendWhatsAppMessage(
      sender,
      `✅ Name recorded: *${text}*.\nPlease enter your gender (Male/Female):`
    );
  }

  if (currentContext?.step === "selectGender") {
    if (text.toLowerCase() === "male" || text.toLowerCase() === "female") {
      userContext[sender] = {
        step: "enterDate",
        service: currentContext.service,
        name: currentContext.name,
        gender: text,
      };
      return await sendWhatsAppMessage(
        sender,
        `✅ Gender recorded: *${text}*. \nPlease enter the date for your appointment (YYYY-MM-DD):`
      );
    } else {
      return await sendWhatsAppMessage(
        sender,
        `❌ Invalid gender. Please enter *Male* or *Female*: `
      );
    }
  }

  if (currentContext?.step === "enterDate") {
    userContext[sender] = {
      step: "enterTime",
      service: currentContext.service,
      name: currentContext.name,
      gender: currentContext.gender,
      date: text,
    };
    return await sendWhatsAppMessage(
      sender,
      `✅ Date recorded: *${text}*.\nPlease enter the time for your appointment (HH:MM AM/PM):`
    );
  }

  if (currentContext?.step === "enterTime") {
    userContext[sender] = {
      step: "preview",
      service: currentContext.service,
      name: currentContext.name,
      gender: currentContext.gender,
      date: currentContext.date,
      time: text,
      phone: sender,
    };
    return await sendWhatsAppMessage(
      sender,
      `📋 *Appointment Summary:*\n👤 Name: *${currentContext.name}*\n⚧ Gender: *${currentContext.gender}*\n📅 Date: *${currentContext.date}*\n⏰ Time: *${text}*\n📞 Phone: *${sender}*\n\n✅ Please confirm by replying with *YES* or cancel with *NO*.`
    );
  }

  if (currentContext?.step === "preview") {
    if (text.toLowerCase() === "yes") {
      await sendWhatsAppMessage(
        sender,
        `🎉 Your appointment has been successfully booked! We will contact you shortly with further details.`
      );
      delete userContext[sender];
    } else if (text.toLowerCase() === "no") {
      await sendWhatsAppMessage(
        sender,
        `❌ Your appointment has been canceled. You can start over if needed.`
      );
      delete userContext[sender];
    } else {
      await sendWhatsAppMessage(
        sender,
        `⚠️ Please reply with *YES* to confirm or *NO* to cancel.`
      );
    }
  }
}

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
  let menuString = "";
  let counter = "a";
  for (const key in submenu) {
    menuString += `${counter}. ${submenu[key]}\n`;
    counter = String.fromCharCode(counter.charCodeAt(0) + 1);
  }
  return menuString;
}

function generateServiceMenu() {
  return Object.entries(SERVICE_OPTIONS)
    .map(([key, option]) => `${key}. ${option.name}`)
    .join("\n");
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
