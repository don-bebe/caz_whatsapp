const express = require("express");
const {
  signUpStaff,
  signInStaff,
  allStaff,
  countStaff,
  updateUser,
} = require("../controllers/StaffAuth");
const { verifyUser, adminOnly } = require("../helpers/verifyUser");

const router = express.Router();

router.post("/signup", verifyUser, adminOnly, signUpStaff);
router.post("/signin", signInStaff);
router.patch("/update/:uuid", verifyUser, adminOnly, updateUser)
router.get("/all", verifyUser, adminOnly, allStaff);
router.get("/count", verifyUser, adminOnly, countStaff);

module.exports = router;
