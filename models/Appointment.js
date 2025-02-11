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
    service: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    phone: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    bookingDate: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notEmpty: true,
        is: /^\d{4}-\d{2}-\d{2}$/, // Ensures format YYYY-MM-DD
        isDate(value) {
          if (isNaN(Date.parse(value))) {
            throw new Error("Invalid date format. Use YYYY-MM-DD.");
          }
        },
      },
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
      type: DataTypes.ENUM("pending", "cancelled", "approved", "rescheduled"),
      allowNull: false,
      defaultValue: "pending",
    },
  },
  { freezeTableName: true, timestamps: true }
);

module.exports = Appointment;
