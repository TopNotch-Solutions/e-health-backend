'use strict';

/** Clinical referral fields, prep, emergency priority, and sonar queue link. */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('sonar_requests', 'symptoms', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
    await queryInterface.addColumn('sonar_requests', 'diagnostic_questions', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
    await queryInterface.addColumn('sonar_requests', 'prep_instructions', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
    await queryInterface.addColumn('sonar_requests', 'is_emergency', {
      type: Sequelize.BOOLEAN,
      defaultValue: false,
    });
    await queryInterface.addColumn('sonar_requests', 'queue_entry_id', {
      type: Sequelize.CHAR(36),
      allowNull: true,
      references: { model: 'queue_entries', key: 'id' },
    });
    await queryInterface.addColumn('sonar_requests', 'imaging_notes', {
      type: Sequelize.TEXT,
      allowNull: true,
    });

    await queryInterface.addColumn('sonar_results', 'impression', {
      type: Sequelize.TEXT,
      allowNull: true,
    });

    await queryInterface.sequelize.query(`
      ALTER TABLE sonar_requests
      MODIFY status ENUM('pending', 'in_progress', 'awaiting_report', 'completed')
      NOT NULL DEFAULT 'pending'
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE sonar_requests
      MODIFY status ENUM('pending', 'in_progress', 'completed')
      NOT NULL DEFAULT 'pending'
    `);
    await queryInterface.removeColumn('sonar_results', 'impression');
    await queryInterface.removeColumn('sonar_requests', 'imaging_notes');
    await queryInterface.removeColumn('sonar_requests', 'queue_entry_id');
    await queryInterface.removeColumn('sonar_requests', 'is_emergency');
    await queryInterface.removeColumn('sonar_requests', 'prep_instructions');
    await queryInterface.removeColumn('sonar_requests', 'diagnostic_questions');
    await queryInterface.removeColumn('sonar_requests', 'symptoms');
  },
};
