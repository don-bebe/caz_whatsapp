const db = require("../config/dbconnection");
const { sendWhatsAppMessage } = require("../helpers/WhatsAppMessages");
const Appointment = require("../models/Appointment");
const { Op } = require("sequelize");
const AppointmentHistory = require("../models/AppointmentHistory");
const RescheduleAppointment = require("../models/RescheduleAppointment");

const getAllAppointments = async (req, res) => {
  try {
    const response = await Appointment.findAll({
      include: [
        {
          model: RescheduleAppointment,
        },
      ],
    });

    if (response && response.length > 0) {
      return res.status(200).json(response);
    } else {
      return res.status(404).json({ message: "No appointments found" });
    }
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Internal server error: " + error.message });
  }
};

const approveAppointments = async (req, res) => {
  const transaction = await db.transaction();
  try {
    const updates = req.body;
    const appointment = await Appointment.findByPk(req.params.uuid, {
      transaction,
    });

    if (!appointment) {
      await transaction.rollback();
      return res.status(404).json({ message: "Appointment not found" });
    }

    for (const field in updates) {
      if (
        Object.prototype.hasOwnProperty.call(updates, field) &&
        updates[field] !== appointment[field]
      ) {
        appointment[field] = updates[field];
      }
    }

    await AppointmentHistory.create(
      {
        appointment_uuid: appointment.uuid,
        status: req.body.status,
        reason: req.body.status,
      },
      { transaction }
    );

    if (req.body.status === "approved") {
      await sendWhatsAppMessage(
        appointment.phone,
        "Your appointment request have been approved. We hope to see you soon."
      );
    }

    if (req.body.status === "rescheduled") {
      await sendWhatsAppMessage(
        appointment.phone,
        "We kindly request that your reschedule your appointment "
      );
    }

    await appointment.save({ transaction });
    await transaction.commit();

    return res
      .status(200)
      .json({ message: "Appointment details updated successfully!" });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Internal server error: " + error.message });
  }
};

const addNewAppointment = async (req, res) => {
  const transaction = await db.transaction();
  try {
    const { fullName, bookingDate, bookingTime, phone, service } = req.body;
    const appointment = await Appointment.findOne({
      where: {
        phone,
        status: "pending",
      },
      transaction,
    });

    if (appointment) {
      await transaction.rollback();
      return res.status(409).json({
        message: "User has an appointment still pending approval",
      });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayAppointment = await Appointment.findOne({
      where: {
        phone: sender,
        createdAt: {
          [Op.gte]: today,
        },
      },
      transaction,
    });

    if (todayAppointment) {
      await transaction.rollback();
      return res.status(409).json({
        message: "",
      });
    }

    await Appointment.create(
      {
        fullName: fullName,
        service: service,
        bookingDate: bookingDate,
        bookingTime: bookingTime,
        phone: phone,
      },
      { transaction }
    );

    await transaction.commit();

    return res
      .status(200)
      .json({ message: "New appointment successfully booked" });
  } catch (error) {
    await transaction.rollback();
    return res
      .status(500)
      .json({ message: "Internal server error: " + error.message });
  }
};

module.exports = { getAllAppointments, approveAppointments, addNewAppointment };
