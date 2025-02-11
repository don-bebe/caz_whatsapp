require("dotenv").config();
const express = require("express");
const axios = require("axios");
const dialogflow = require("@google-cloud/dialogflow");
const stringSimilarity = require("string-similarity");
const fs = require("fs");
const path = require("path");
const moment = require("moment");
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

    if (message.text) {
      const text = message.text.body.trim().toLowerCase();
      const exactMatch = welcomeMessages.some((msg) =>
        new RegExp(`\\b${msg}\\b`, "i").test(text)
      );
      const bestMatch = stringSimilarity.findBestMatch(
        text,
        welcomeMessages
      ).bestMatch;
      const fuzzyMatch = bestMatch.rating > 0.7;

      if (exactMatch || fuzzyMatch) {
        await sendWhatsAppList(sender);
        return res.sendStatus(200);
      }
    }

    if (message.interactive) {
      const buttonReply = message.interactive.button_reply?.id;
      const listReply = message.interactive.list_reply?.id;

      // Handle Make Appointment button
      if (buttonReply === "make_appointment") {
        userContext[sender] = { mode: "appointment" };
        await sendServiceOptions(sender);
        return res.sendStatus(200);
      }

      // Handle Manage Appointments button
      if (buttonReply === "manage_appointments") {
        userContext[sender] = { mode: "manage_appointments" };
        await sendManageAppointmentsMenu(sender);
        return res.sendStatus(200);
      }

      //Handle Learn Cancer button
      if (buttonReply === "learn_cancer") {
        userContext[sender] = { mode: "learn_cancer" };
        await sendWhatsAppMessage(
          sender,
          "What do you want to know about cancer. Ask any question"
        );
        return res.sendStatus(200);
      }

      if (listReply) {
        // Handle Making Appointment Steps
        if (listReply.startsWith("service_")) {
          userContext[sender] = { service: listReply.replace("service_", "") };

          await requestDateInput(sender);
          return res.sendStatus(200);
        }

        if (
          message.text.body &&
          userContext[sender]?.service &&
          !userContext[sender]?.date
        ) {
          const userDate = message.text.body?.trim();
          const validation = isValidAppointmentDate(userDate);

          if (!validation.valid) {
            await sendWhatsAppMessage(sender, validation.message);
            return res.sendStatus(200);
          }
          userContext[sender].date = message.text.body;
          await sendTimeSelection(sender);
          return res.sendStatus(200);
        }

        if (listReply.startsWith("time_")) {
          userContext[sender].time = listReply.replace("time_", "");
          await askFullName(sender);
          return res.sendStatus(200);
        }

        // Handle Manage Appointment options
        if (listReply === "upcoming_appointments") {
          userContext[sender] = { mode: "view_upcoming" };
          await sendUpcomingAppointments(sender);
          return res.sendStatus(200);
        }

        if (listReply === "past_appointments") {
          userContext[sender] = { mode: "view_past" };
          await sendPastAppointments(sender);
          return res.sendStatus(200);
        }

        if (listReply === "cancel_reschedule") {
          userContext[sender] = { mode: "cancel_reschedule" };
          await sendCancelRescheduleOptions(sender);
          return res.sendStatus(200);
        }
      }
    }

    if (message.text && !userContext[sender]?.fullName) {
      userContext[sender].fullName = message.text.trim();
      userContext[sender].phone = sender;
      await sendConfirmationForm(sender);
      return res.sendStatus(200);
    }

    if (
      message.text &&
      message.text.toLowerCase() === "confirm" &&
      userContext[sender]?.fullName
    ) {
      const currentContext = userContext[sender];
      const transaction = await db.transaction();
      try {
        await Appointment.create(
          {
            fullName: currentContext.fullName,
            service: currentContext.service,
            bookingDate: currentContext.date,
            bookingTime: currentContext.time,
            phone: currentContext.phone,
          },
          { transaction }
        );

        await transaction.commit();
        await sendWhatsAppMessage(
          sender,
          `✅ Your appointment request has been submitted for ${currentContext.date} at ${currentContext.time}.\n *Please wait for approval*.}`
        );
      } catch (error) {
        await transaction.rollback();
        console.error("Error creating appointment:", error.message);
        await sendWhatsAppMessage(
          sender,
          "❌ There was an error with your appointment request. Please try again later."
        );
      }
    }

    if (message.text && userContext[sender]?.mode === "learn_cancer") {
      const userInput = message.text;
      const sessionId = sender; // Use sender's number as session ID

      const dialogflowResponse = await generateDialogflowResponse(
        userInput,
        sessionId
      );

      await sendWhatsAppMessage(sender, dialogflowResponse);
      return res.sendStatus(200);
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

async function sendWhatsAppList(to) {
  const url = `https://graph.facebook.com/${process.env.WHATSAPP_CLOUD_VERSION}/${process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID}/messages`;

  const data = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      header: {
        type: "image",
        image: {
          link: "https://cancerzimbabwe.org/images/logo.png",
        },
      },
      body: {
        text: "*Welcome to the Cancer Association of Zimbabwe Chatbot*\n\nHow can we assist you today?",
      },
      action: {
        buttons: [
          {
            type: "reply",
            reply: {
              id: "make_appointment",
              title: "Make an appointment",
            },
          },
          {
            type: "reply",
            reply: {
              id: "manage_appointments",
              title: "Manage appointments",
            },
          },
          {
            type: "reply",
            reply: {
              id: "learn_cancer",
              title: "Learn about Cancer",
            },
          },
        ],
      },
    },
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

async function sendServiceOptions(to) {
  const url = `https://graph.facebook.com/${process.env.WHATSAPP_CLOUD_VERSION}/${process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID}/messages`;

  const data = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: {
        text: "*Choose a service:*",
      },
      action: {
        button: "Select Service",
        sections: [
          {
            title: "Available Services",
            rows: [
              {
                id: "service_consultation",
                title: "Consultation",
                description: "Book a consultation appointment",
              },
              {
                id: "service_screening",
                title: "Screening",
                description: "Book a screening test",
              },
              {
                id: "service_diagnostic",
                title: "Diagnostic",
                description: "Book a diagnostic test",
              },
              {
                id: "service_treatment",
                title: "Treatment",
                description: "Book a treatment session",
              },
              {
                id: "service_supportive",
                title: "Supportive Care",
                description: "Book a supportive care service",
              },
              {
                id: "service_breast_care",
                title: "Breast care",
                description: "Book a breast care appointment",
              },
            ],
          },
        ],
      },
    },
  };

  try {
    const response = await axios.post(url, data, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.WHATSAPP_CLOUD_ACCESS_TOKEN}`,
      },
    });
    console.log("Service options sent:", response.data);
  } catch (error) {
    console.error("WhatsApp API Error:", error.response?.data || error.message);
  }
}

async function requestDateInput(to) {
  const url = `https://graph.facebook.com/${process.env.WHATSAPP_CLOUD_VERSION}/${process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID}/messages`;

  const data = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: {
      body: "📅 *Please enter your preferred appointment date (YYYY-MM-DD).* \n\n⚠️ The date must be:\n✅ At least *24 hours* from today\n❌ *Not a Sunday*",
    },
  };

  try {
    const response = await axios.post(url, data, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.WHATSAPP_CLOUD_ACCESS_TOKEN}`,
      },
    });
    console.log("Date request sent:", response.data);
  } catch (error) {
    console.error("WhatsApp API Error:", error.response?.data || error.message);
  }
}

async function sendTimeSelection(to) {
  const url = `https://graph.facebook.com/${process.env.WHATSAPP_CLOUD_VERSION}/${process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID}/messages`;

  const data = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: {
        text: "*Please select a time for your appointment:*",
      },
      action: {
        button: "Select Time",
        sections: [
          {
            title: "Available Time Slots",
            rows: [
              { id: "time_8am", title: "08:00 AM" },
              { id: "time_9am", title: "09:00 AM" },
              { id: "time_10am", title: "10:00 AM" },
              { id: "time_11am", title: "11:00 AM" },
              { id: "time_12pm", title: "12:00 PM" },
              { id: "time_1pm", title: "01:00 PM" },
              { id: "time_2pm", title: "02:00 PM" },
              { id: "time_3pm", title: "03:00 PM" },
              { id: "time_4pm", title: "04:00 PM" },
            ],
          },
        ],
      },
    },
  };

  try {
    const response = await axios.post(url, data, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.WHATSAPP_CLOUD_ACCESS_TOKEN}`,
      },
    });
    console.log("Time selection sent:", response.data);
  } catch (error) {
    console.error("WhatsApp API Error:", error.response?.data || error.message);
  }
}

async function askFullName(to) {
  const url = `https://graph.facebook.com/${process.env.WHATSAPP_CLOUD_VERSION}/${process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID}/messages`;

  const data = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: {
      body: "*Please enter your full name:*",
    },
  };

  try {
    const response = await axios.post(url, data, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.WHATSAPP_CLOUD_ACCESS_TOKEN}`,
      },
    });
    console.log("Full name request sent:", response.data);
  } catch (error) {
    console.error("WhatsApp API Error:", error.response?.data || error.message);
  }
}

async function sendConfirmationForm(to) {
  const { service, date, time, fullName } = userContext[to];

  const confirmationMessage = `Please confirm your appointment details:
  - **Service**: ${service}
  - **Date**: ${date}
  - **Time**: ${time}
  - **Full Name**: ${fullName}

If everything is correct, reply with 'Confirm' to book your appointment.`;

  const url = `https://graph.facebook.com/${process.env.WHATSAPP_CLOUD_VERSION}/${process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID}/messages`;

  const data = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { body: confirmationMessage },
  };

  try {
    const response = await axios.post(url, data, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.WHATSAPP_CLOUD_ACCESS_TOKEN}`,
      },
    });
    console.log("Confirmation form sent:", response.data);
  } catch (error) {
    console.error("WhatsApp API Error:", error.response?.data || error.message);
  }
}

async function sendManageAppointmentsMenu(to) {
  const url = `https://graph.facebook.com/${process.env.WHATSAPP_CLOUD_VERSION}/${process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID}/messages`;

  const data = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: {
        text: "*Manage your appointments:*",
      },
      action: {
        button: "Select Option",
        sections: [
          {
            title: "Appointment Options",
            rows: [
              {
                id: "upcoming_appointments",
                title: "📅 Upcoming Appointments",
                description: "View your scheduled upcoming appointments",
              },
              {
                id: "past_appointments",
                title: "🗓️ Past Appointments",
                description: "View your past completed appointments",
              },
              {
                id: "cancel_reschedule",
                title: "❌ Cancel / Reschedule",
                description: "Cancel or reschedule an existing appointment",
              },
            ],
          },
        ],
      },
    },
  };

  try {
    const response = await axios.post(url, data, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.WHATSAPP_CLOUD_ACCESS_TOKEN}`,
      },
    });
    console.log("Manage appointments menu sent:", response.data);
  } catch (error) {
    console.error("WhatsApp API Error:", error.response?.data || error.message);
  }
}

async function sendUpcomingAppointments(to) {
  try {
    const upcomingAppointments = await Appointment.findAll({
      where: {
        phone: to,
        bookingDate: { [Op.gte]: new Date() }, // Future dates
      },
      order: [["bookingDate", "ASC"]],
    });

    if (upcomingAppointments.length === 0) {
      await sendWhatsAppMessage(to, "🔔 You have no upcoming appointments.");
      return;
    }

    let message = "*Your Upcoming Appointments:*\n\n";
    upcomingAppointments.forEach((apt, index) => {
      message += `📅 *${apt.bookingDate}* at *${apt.bookingTime}* \n🩺 ${apt.service}\n\n`;
    });

    await sendWhatsAppMessage(to, message);
  } catch (error) {
    console.error("Error fetching upcoming appointments:", error.message);
    await sendWhatsAppMessage(
      to,
      "❌ Unable to fetch upcoming appointments. Please try again later."
    );
  }
}

async function sendPastAppointments(to) {
  try {
    const pastAppointments = await Appointment.findAll({
      where: {
        phone: to,
        bookingDate: { [Op.lt]: new Date() }, // Past dates
      },
      order: [["bookingDate", "DESC"]],
    });

    if (pastAppointments.length === 0) {
      await sendWhatsAppMessage(to, "📌 You have no past appointments.");
      return;
    }

    let message = "*Your Past Appointments:*\n\n";
    pastAppointments.forEach((apt, index) => {
      message += `📅 *${apt.bookingDate}* at *${apt.bookingTime}* \n🩺 ${apt.service}\n\n`;
    });

    await sendWhatsAppMessage(to, message);
  } catch (error) {
    console.error("Error fetching past appointments:", error.message);
    await sendWhatsAppMessage(
      to,
      "❌ Unable to fetch past appointments. Please try again later."
    );
  }
}

async function sendCancelRescheduleOptions(to) {
  try {
    const upcomingAppointments = await Appointment.findAll({
      where: {
        phone: to,
        bookingDate: { [Op.gte]: new Date() }, // Future dates only
      },
      order: [["bookingDate", "ASC"]],
    });

    if (upcomingAppointments.length === 0) {
      await sendWhatsAppMessage(
        to,
        "🚫 You have no upcoming appointments to cancel or reschedule."
      );
      return;
    }

    let message = "*Select an appointment to cancel or reschedule:*\n\n";
    upcomingAppointments.forEach((apt, index) => {
      message += `${index + 1}. 📅 *${apt.bookingDate}* at *${
        apt.bookingTimeTitle
      }*\n🩺 ${apt.serviceTitle}\n\n`;
    });

    await sendWhatsAppMessage(
      to,
      message + "Reply with the number of the appointment."
    );
  } catch (error) {
    console.error("Error fetching appointments:", error.message);
    await sendWhatsAppMessage(
      to,
      "❌ Unable to fetch appointments. Please try again later."
    );
  }
}

function isValidAppointmentDate(dateString) {
  const date = moment(dateString, "YYYY-MM-DD", true);

  if (!date.isValid()) {
    return {
      valid: false,
      message: "Please enter a valid date in YYYY-MM-DD format.",
    };
  }

  const now = moment();
  if (date.isBefore(now.add(1, "day"), "day")) {
    return {
      valid: false,
      message: "Please select a date at least 24 hours from today.",
    };
  }

  if (date.day() === 0) {
    return {
      valid: false,
      message:
        "Appointments cannot be scheduled on Sundays. Please select another day.",
    };
  }

  return { valid: true };
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
