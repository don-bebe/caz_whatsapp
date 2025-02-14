const bcrypt = require("bcrypt");
const db = require("../config/dbconnection");
const StaffDetails = require("../models/StaffDetails");

const signUpStaff = async (req, res) => {
  const transaction = await db.transaction();
  try {
    const { fullName, phone, email, password, confirmPassword } = req.body;
    const response = await StaffDetails.findOne({
      where: {
        email,
        phone,
      },
      transaction,
    });

    if (response) {
      await transaction.rollback();
      return res.status(409).json({
        message: "User details already exists",
      });
    }

    if (password !== confirmPassword)
      return res.status(400).json({ message: "Password entered don`t match" });

    if (password.length < 8 || password.length > 16) {
      return res
        .status(401)
        .json({ message: "Password must be between 8 and 12 characters" });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    await StaffDetails.create(
      {
        fullName,
        email,
        phone,
        password: hashedPassword,
      },
      { transaction }
    );

    await transaction.commit();
    return res.status(201).json({ message: "You have successfully signed up" });
  } catch (error) {
    await transaction.rollback();
    return res
      .status(500)
      .json({ message: "Internal server error: " + error.message });
  }
};

const signInStaff = async (req, res) => {
  const transaction = await db.transaction();
  try {
    const { email, password } = req.body;
    const staff = await StaffDetails.findOne({
      where: {
        email,
      },
      transaction,
    });

    if (!staff) {
      await transaction.rollback();
      return res
        .status(404)
        .json({ message: "Invalid emailAddress or password" });
    }

    const match = await bcrypt.compare(password, staff.password);

    if (!match) {
      await transaction.rollback();
      return res.status(404).json({ message: "Wrong email/password!" });
    }

    req.session.userId = staff.uuid;
    
    const name = staff.fullName;
    const phone = staff.phone;

    await transaction.commit();

    return res
      .status(200)
      .json({ name, email, phone, message: `Welcome ${name}` });
  } catch (error) {
    await transaction.rollback();
    return res
      .status(500)
      .json({ message: "Internal server error: " + error.message });
  }
};

module.exports = { signUpStaff, signInStaff };
