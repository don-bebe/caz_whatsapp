const { DataTypes } = require("sequelize");
const db = require("../config/dbconnection");

const StaffDetails = db.define(
  "staff_details",
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
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        isEmail: true,
        notEmpty: true,
      },
    },
    phone: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notEmpty: true,
        is: /^[(]?[0-9]{1,4}[)]?[-\s./0-9]*$/i, // Regex to validate local and international numbers
      },
    },
    password: {
      type: DataTypes.STRING,
      allowNull: false,
    },
  },
  { freezeTableName: true, timestamps: true }
);

module.exports = StaffDetails;
