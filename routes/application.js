const express = require("express");
const {
  getAllAppointments,
  approveAppointments,
  addNewAppointment,
  countAllAppointments,
  countAllPendingAppointments,
  countTodayAppointments,
  appointmentsTodayCalender,
} = require("../controllers/Appointment");
const { verifyUser, adminOnly } = require("../helpers/verifyUser");

const router = express.Router();

router.get("/all", verifyUser, getAllAppointments);
router.get("/count", verifyUser, countAllAppointments);
router.get("today", verifyUser, appointmentsTodayCalender);
router.get("/countp", verifyUser, adminOnly, countAllPendingAppointments);
router.get("/countt", verifyUser, countTodayAppointments);
router.patch("/update/:uuid", verifyUser, adminOnly, approveAppointments);
router.post("/add", verifyUser, adminOnly, addNewAppointment);

module.exports = router;
