const { DataTypes } = require("sequelize");
const db = require("../config/dbconnection");

const Appointment = db.define(
  "appointment",
  {
    uuid: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false,
      validate: {
        notEmpty: true,
      },
    },
    fullName: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notEmpty: true,
      },
    },
    gender: {
      type: DataTypes.ENUM("male", "female"),
      allowNull: false,
    },
    service: {
      type: DataTypes.ENUM(
        "consultation",
        "screening and diagnostic tests",
        "treatment",
        "supportive care services"
      ),
      allowNull: false,
    },
    phone: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    bookingDate: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    bookingTime: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notEmpty: true,
        is: /^([01]?[0-9]|2[0-3]):([0-5][0-9])$/,
      },
    },
    status: {
      type: DataTypes.ENUM("pending", "cancelled", "approved"),
      allowNull: false,
      defaultValue: "pending",
    },
  },
  { freezeTableName: true, timestamps: true }
);

module.exports = Appointment;
