const express = require("express");
const { signUpStaff, signInStaff } = require("../controllers/StaffAuth");

const router = express.Router();

router.post("/signup", signUpStaff);
router.post("/signin", signInStaff);

module.exports = router;
