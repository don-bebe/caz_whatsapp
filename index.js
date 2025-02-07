require("dotenv").config();
const express = require("express");
const axios = require("axios");
const dialogflow = require("@google-cloud/dialogflow");
const stringSimilarity = require("string-similarity");
const fs = require("fs");
const path = require("path");
const { Op } = require("sequelize");
const db = require("./config/dbconnection");
const Appointment = require("./models/Appointment");

const app = express();
const PORT = process.env.APP_PORT || 5000;

app.use(express.json());

db.sync()
  .then(() => console.log("Database connected and models synced"))
  .catch((err) => console.error("Database connection error:", err));

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
    name: "Manage appointments",
    submenu: {
      a: "Upcoming Appointments",
      b: "Past Appointments",
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

    if (handleAppointmentBooking(sender, text)) {
      return res.sendStatus(200);
    }

    if(handleManageAppointment(sender, text)){
      return res.sendStatus(200);
    }

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
    await sendWhatsAppMessage(
      sender,
      `🗓️ *Appointment Booking* Please select a service:\n\n ${generateServiceMenu()} \n(Reply with the number of your choice)`
    );
    return true;
  }

  if (currentContext?.step === "selectService") {
    if (SERVICE_OPTIONS[text]) {
      userContext[sender] = {
        step: "enterName",
        service: SERVICE_OPTIONS[text].name,
      };
      await sendWhatsAppMessage(
        sender,
        `✅ You have selected *${SERVICE_OPTIONS[text].name}*. \nPlease enter your full name:`
      );
      return true;
    } else {
      await sendWhatsAppMessage(
        sender,
        `❌ Invalid selection. Please choose a valid service:\n${generateServiceMenu()}`
      );
      return true;
    }
  }

  if (currentContext?.step === "enterName") {
    userContext[sender] = {
      step: "selectGender",
      service: currentContext.service,
      name: text,
    };
    await sendWhatsAppMessage(
      sender,
      `✅ Name recorded: *${text}*.\nPlease enter your gender (Male/Female):`
    );
    return true;
  }

  if (currentContext?.step === "selectGender") {
    if (text.toLowerCase() === "male" || text.toLowerCase() === "female") {
      userContext[sender] = {
        step: "enterDate",
        service: currentContext.service,
        name: currentContext.name,
        gender: text,
      };
      await sendWhatsAppMessage(
        sender,
        `✅ Gender recorded: *${text}*. \nPlease enter the date for your appointment (YYYY-MM-DD):`
      );
      return true;
    } else {
      await sendWhatsAppMessage(
        sender,
        `❌ Invalid gender. Please enter *Male* or *Female*: `
      );
      return true;
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
    await sendWhatsAppMessage(
      sender,
      `✅ Date recorded: *${text}*.\nPlease enter the time for your appointment (HH:MM AM/PM):`
    );
    return true;
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
    await sendWhatsAppMessage(
      sender,
      `📋 *Appointment Summary:*\n👤 Name: *${currentContext.name}*\n⚧ Gender: *${currentContext.gender}*\n📅 Date: *${currentContext.date}*\n⏰ Time: *${text}*\n📞 Phone: *${sender}*\n🈂️ Service: *${currentContext.service}*\n\n✅ Please confirm by replying with *YES* or cancel with *NO*.`
    );
    return true;
  }

  if (currentContext?.step === "preview") {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const existingAppointment = await Appointment.findOne({
      where: {
        phone: sender,
        status: "pending",
      },
    });

    const todayAppointment = await Appointment.findOne({
      where: {
        sender,
        createdAt: {
          [Op.gte]: today,
        },
      },
    });

    if (existingAppointment) {
      await sendWhatsAppMessage(
        sender,
        `⚠️ You already have an appointment that is pending approval. Please wait for confirmation before making another request.`
      );
      return true;
    }

    if (todayAppointment) {
      await sendWhatsAppMessage(
        sender,
        `⚠️ You can only apply for one appointment per day. Please try again tomorrow.`
      );
      return true;
    }

    if (text.toLowerCase() === "yes") {
      const transaction = await db.transaction();
      try {
        await Appointment.create(
          {
            fullName: currentContext.name,
            gender: currentContext.gender,
            service: currentContext.service,
            bookingDate: currentContext.date,
            bookingTime: currentContext.time,
            phone: sender,
          },
          { transaction }
        );
        await transaction.commit();
        await sendWhatsAppMessage(
          sender,
          `✅ Your appointment request has been submitted. Please wait for approval.`
        );
      } catch (error) {
        await transaction.rollback();
        await sendWhatsAppMessage(
          sender,
          `❌ Failed to save your appointment. Please try again later.`
        );
      }
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
    return true;
  }

  return false;
}

async function handleManageAppointment(sender, text) {
  const currentContext = userContext[sender];
  if (text === "2" && !currentContext) {
    userContext[sender] = { step: "manageAppointments" };
    await sendWhatsAppMessage(
      sender,
      `You selected: *Manage Appointments*\n\nPlease choose an option:\n\n${generateSubMenu(
        MENU_OPTIONS[2].submenu
      )}`
    );
    return true;
  }

  if (currentContext?.step === "manageAppointments") {
    if (text === "a" || text === "A") {
      const today = new Date();
      const upcomingAppointments = await Appointment.findAll({
        where: {
          phone: sender,
          bookingDate: { [Op.gte]: today },
        },
        order: [["bookingDate", "ASC"]],
      });

      if (upcomingAppointments.length === 0) {
        await sendWhatsAppMessage(sender, "You have no upcoming appointments.");
      } else {
        let message = `🗓️ *Upcoming Appointments:*\n`;
        upcomingAppointments.forEach((appointment) => {
          message += `📅 ${appointment.bookingDate} at ${appointment.bookingTime}\nService: ${appointment.service}\nStatus: ${appointment.status}\n`;
        });
        await sendWhatsAppMessage(sender, message);
      }
      delete userContext[sender];
      return true;
    } else if (text === "b" || text === "B") {
      const appointments = await Appointment.findAll({
        where: { phone: sender },
        order: [["createdAt", "DESC"]],
      });
      if (appointments.length === 0) {
        await sendWhatsAppMessage(sender, "You have no past appointments.");
      } else {
        let message = `🗓️ *Past Appointments:*\n`;
        appointments.forEach((appointment) => {
          message += `📅 ${appointment.bookingDate} at ${appointment.bookingTime}\nService: ${appointment.service}\nStatus: ${appointment.status}\n`;
        });
        await sendWhatsAppMessage(sender, message);
      }
      delete userContext[sender];
      return true;
    } else if (text === "c" || text === "C") {
      const appointments = await Appointment.findAll({
        where: {
          phone: sender,
          status: "pending",
        },
      });
      if (appointments.length > 0) {
        let message = `📅 *Your Appointments:* \n`;
        appointments.forEach((appointment, index) => {
          message += `${index + 1}. ${appointment.bookingDate} at ${
            appointment.bookingTime
          } - Service: ${appointment.service}\n`;
        });
        message += `\nTo cancel or reschedule, reply with the appointment number:`;
        userContext[sender] = { step: "cancelOrReschedule", appointments };
        await sendWhatsAppMessage(sender, message);
      } else {
        await sendWhatsAppMessage(
          sender,
          `You have no active appointments to cancel or reschedule.`
        );
      }
      return true;
    } else {
      await sendWhatsAppMessage(
        sender,
        "Invalid selection. Please choose from the list below:\n\n" +
          generateSubMenu(MENU_OPTIONS[2].submenu)
      );
    }
    return true;
  }

  if (currentContext?.step === "cancelOrReschedule") {
    const selectedAppointment = currentContext.appointments[parseInt(text) - 1];
    if (selectedAppointment) {
      await sendWhatsAppMessage(
        sender,
        `You selected: *${selectedAppointment.bookingDate} at ${selectedAppointment.bookingTime}*.\n\nWould you like to cancel or reschedule? Reply with *CANCEL* or *RESCHEDULE*.`
      );
      return;
    } else {
      return await sendWhatsAppMessage(
        sender,
        `Invalid appointment number. Please choose again.`
      );
    }
  }

  if (
    currentContext?.step === "cancelOrReschedule" &&
    text.toLowerCase() === "cancel"
  ) {
    const appointmentToCancel = currentContext.appointments[parseInt(text) - 1];
    await appointmentToCancel.update({ status: "cancelled" });

    await sendWhatsAppMessage(
      sender,
      `Your appointment on ${appointmentToCancel.bookingDate} at ${appointmentToCancel.bookingTime} has been cancelled.`
    );
    delete userContext[sender];
  }

  if (
    currentContext?.step === "cancelOrReschedule" &&
    text.toLowerCase() === "reschedule"
  ) {
    const appointmentToReschedule =
      currentContext.appointments[parseInt(text) - 1];
    userContext[sender] = {
      step: "selectNewDate",
      appointmentId: appointmentToReschedule.uuid,
    };

    await sendWhatsAppMessage(
      sender,
      `You selected to reschedule your appointment on ${appointmentToReschedule.bookingDate} at ${appointmentToReschedule.bookingTime}.\nPlease enter a new date (YYYY-MM-DD):`
    );
  }

  if (currentContext?.step === "selectNewDate") {
    const appointmentToReschedule = await Appointment.findByPk(
      currentContext.appointmentId
    );
    appointmentToReschedule.bookingDate = text;

    await appointmentToReschedule.save();
    await sendWhatsAppMessage(
      sender,
      `Your appointment has been rescheduled to ${text}.`
    );
    delete userContext[sender];
  }

  return false;
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
