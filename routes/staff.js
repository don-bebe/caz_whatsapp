const express = require("express");
const {
  signUpStaff,
  signInStaff,
  allStaff,
  countStaff,
} = require("../controllers/StaffAuth");
const { verifyUser, adminOnly } = require("../helpers/verifyUser");

const router = express.Router();

router.post("/signup", signUpStaff);
router.post("/signin", signInStaff);
router.get("/all", verifyUser, adminOnly, allStaff);
router.get("/count", verifyUser, adminOnly, countStaff);

module.exports = router;
