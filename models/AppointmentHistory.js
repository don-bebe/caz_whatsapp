const { DataTypes } = require("sequelize");
const db = require("../config/dbconnection");
const Appointment = require("./Appointment");

const AppointmentHistory = db.define(
  "appointment_history",
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
    status: {
      type: DataTypes.ENUM("pending", "cancelled", "approved", "rescheduled"),
      allowNull: false,
    },
    reason: {
      type: DataTypes.STRING,
      allowNull: false,
    },
  },
  { freezeTableName: true, timestamps: true }
);

Appointment.hasMany(AppointmentHistory, {
  foreignKey: "appointment_uuid",
});

AppointmentHistory.belongsTo(Appointment, {
  foreignKey: "appointment_uuid",
});

module.exports = AppointmentHistory;
