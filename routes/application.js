const express = require("express");
const {
  getAllAppointments,
  approveAppointments,
  addNewAppointment,
} = require("../controllers/Appointment");
const { verifyUser } = require("../helpers/verifyUser");

const router = express.Router();

router.get("/all", verifyUser, getAllAppointments);
router.patch("/update/:uuid", verifyUser, approveAppointments);
router.post("/add", verifyUser, addNewAppointment);

module.exports = router;
