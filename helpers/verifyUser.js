const StaffDetails = require("../models/StaffDetails");

const verifyUser = async (req, res, next) => {
  if (!req.session.userId) {
    return res.status(401).json({ message: "Please login to your account!" });
  }

  const user = await StaffDetails.findByPk(req.session.userId);
  if (!user) return res.status(404).json({ message: "User not found" });

  req.userId = user.uuid;
  req.email = user.email;
  req.role = user.role;
  next();
};

const adminOnly = async (req, res, next) => {
  const user = await StaffDetails.findByPk(req.session.userId);
  if (!user) return res.status(404).json({ message: "User not found" });
  if (user.role !== "admin")
    return res.status(403).json({ message: "Access forbidden" });
  next();
};

module.exports = { verifyUser, adminOnly };
