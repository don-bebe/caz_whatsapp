const { DataTypes } = require("sequelize");
const db = require("../config/dbconnection");
const Appointment = require("./Appointment");

const RescheduleAppointment = db.define(
  "reschedule_appointment",
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
    appointment_uuid: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: Appointment,
        key: "uuid",
      },
    },
    rescheduledDate: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notEmpty: true,
        is: /^\d{4}-\d{2}-\d{2}$/,
        isDate(value) {
          if (isNaN(Date.parse(value))) {
            throw new Error("Invalid date format. Use YYYY-MM-DD.");
          }
        },
      },
    },
    rescheduledTime: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notEmpty: true,
        is: /^([01]?[0-9]|2[0-3]):([0-5][0-9])$/,
      },
    },
    message: {
      type: DataTypes.STRING,
      allowNull: false,
    },
  },
  { freezeTableName: true, timestamps: true }
);

Appointment.hasOne(RescheduleAppointment, {
  foreignKey: "appointment_uuid",
});

RescheduleAppointment.belongsTo(Appointment, {
  foreignKey: "appointment_uuid",
});

module.exports = RescheduleAppointment;
