const db = require("../config/dbconnection");
const { sendWhatsAppMessage } = require("../helpers/WhatsAppMessages");
const Appointment = require("../models/Appointment");
const { Op, fn, col } = require("sequelize");
const AppointmentHistory = require("../models/AppointmentHistory");
const RescheduleAppointment = require("../models/RescheduleAppointment");
const moment = require("moment");

const getAllAppointments = async (req, res) => {
  try {
    const response = await Appointment.findAll({
      include: [
        {
          model: RescheduleAppointment,
        },
      ],
      order: [['createdAt', 'DESC']],
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

    if (req.body.status === "cancelled") {
      await sendWhatsAppMessage(
        appointment.phone,
        `Your appointment have been cancelled: ${req.body.message}`
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
    const { fullName, bookingDate, bookingTime, phone, service, status } =
      req.body;
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
        phone: phone,
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
        status: status,
      },
      { transaction }
    );

    await transaction.commit();

    await sendWhatsAppMessage(
      phone,
      `An ${service} appointment has been scheduled on ${bookingDate} at ${bookingTime}. We hope to see you`
    );

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

const appointmentsTodayCalender = async (req, res) => {
  try {
    const startOfDay = moment().startOf("day").toDate();
    const endOfDay = moment().endOf("day").toDate();
    const response = await Appointment.findAll({
      where: {
        bookingDate: {
          [Op.gte]: startOfDay,
          [Op.lte]: endOfDay,
        },
      },
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

const appointmentsThisWeekCalendar = async (req, res) => {
  try {
    const startOfWeek = moment().startOf("week").toDate();
    const endOfWeek = moment().endOf("week").toDate();

    const response = await Appointment.findAll({
      where: {
        bookingDate: {
          [Op.gte]: startOfWeek,
          [Op.lte]: endOfWeek,
        },
      },
    });

    if (response && response.length > 0) {
      return res.status(200).json(response);
    } else {
      return res
        .status(404)
        .json({ message: "No appointments found for this week" });
    }
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Internal server error: " + error.message });
  }
};

const countAllAppointments = async (req, res) => {
  try {
    const count = await Appointment.count();
    return res.status(200).json(count);
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Internal server error: " + error.message });
  }
};

const countAllPendingAppointments = async (req, res) => {
  try {
    const count = await Appointment.count({
      where: {
        status: "pending",
      },
    });
    return res.status(200).json(count);
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Internal server error: " + error.message });
  }
};

const countTodayAppointments = async (req, res) => {
  try {
    const today = moment().format("YYYY-MM-DD"); // Get today's date

    const count = await Appointment.count({
      where: {
        bookingDate: today,
      },
    });

    return res.status(200).json(count);
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Internal server error: " + error.message });
  }
};

const getBookedTimeSlots = async (req, res) => {
  try {
    const { bookingDate } = req.params;

    if (!bookingDate) {
      return res.status(400).json({ message: "bookingDate is required" });
    }

    const bookedAppointments = await Appointment.findAll({
      where: { bookingDate },
      attributes: ["bookingTime"],
    });

    const bookedTimeSlots = bookedAppointments.map(
      (appointment) => appointment.bookingTime
    );

    return res.status(200).json({ bookedSlots: bookedTimeSlots });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Internal server error: " + error.message });
  }
};

const countMostBookedServices = async (req, res) => {
  try {
    const response = await Appointment.findAll({
      attributes: ["service", [fn("COUNT", col("service")), "count"]],
      group: ["service"],
    });
    return res.status(200).json(response);
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Internal server error: " + error.message });
  }
};

const countWeeklyAppointments = async (req, res) => {
  try {
    const response = await Appointment.findAll({
      attributes: [
        [fn("YEARWEEK", col("bookingDate"), 1), "week"],
        [fn("COUNT", col("uuid")), "count"],
      ],
      where: {
        status: "approved",
      },
      group: ["week"],
      order: [["week", "ASC"]],
    });

    return res.status(200).json(response);
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Internal server error: " + error.message });
  }
};

module.exports = {
  getAllAppointments,
  approveAppointments,
  addNewAppointment,
  countAllAppointments,
  countAllPendingAppointments,
  countTodayAppointments,
  appointmentsTodayCalender,
  getBookedTimeSlots,
  appointmentsThisWeekCalendar,
  countMostBookedServices,
  countWeeklyAppointments,
};
