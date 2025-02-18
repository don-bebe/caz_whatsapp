const { DataTypes } = require("sequelize");
const db = require("../config/dbconnection");
const StaffDetails = require("./StaffDetails");

const LoginStats = db.define(
  "login_stats",
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
    staff_uuid: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: StaffDetails,
        key: "uuid",
      },
    },
    ip_address: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    lastLogin: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  { freezeTableName: true, timestamps: true }
);

StaffDetails.hasOne(LoginStats, {
  foreignKey: "staff_uuid",
  constraints: false,
});

LoginStats.belongsTo(StaffDetails, {
  foreignKey: "staff_uuid",
  constraints: false,
});

module.exports = LoginStats;
