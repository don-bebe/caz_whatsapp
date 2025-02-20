const express = require("express");
const {
  getAllAppointments,
  approveAppointments,
  addNewAppointment,
  countAllAppointments,
  countAllPendingAppointments,
  countTodayAppointments,
  appointmentsTodayCalender,
  getBookedTimeSlots,
  appointmentsThisWeekCalendar,
} = require("../controllers/Appointment");
const { verifyUser, adminOnly } = require("../helpers/verifyUser");

const router = express.Router();

router.get("/all", verifyUser, adminOnly,getAllAppointments);
router.get("/time/:bookingDate", verifyUser, adminOnly, getBookedTimeSlots);
router.get("/count", verifyUser, countAllAppointments);
router.get("today", verifyUser, appointmentsTodayCalender);
router.get("/week", verifyUser, appointmentsThisWeekCalendar);
router.get("/countp", verifyUser, adminOnly, countAllPendingAppointments);
router.get("/countt", verifyUser, countTodayAppointments);
router.patch("/update/:uuid", verifyUser, adminOnly, approveAppointments);
router.post("/add", verifyUser, adminOnly, addNewAppointment);

module.exports = router;
