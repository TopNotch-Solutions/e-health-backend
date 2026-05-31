'use strict';

const { addColumnIfMissing, enumColumnIncludes, removeColumnIfExists } = require('./utils/columnHelpers');

/** Clinical referral fields, prep, emergency priority, and sonar queue link. */
module.exports = {
  async up(queryInterface, Sequelize) {
    const sonarRequestColumns = {
      symptoms: { type: Sequelize.TEXT, allowNull: true },
      diagnostic_questions: { type: Sequelize.TEXT, allowNull: true },
      prep_instructions: { type: Sequelize.TEXT, allowNull: true },
      is_emergency: { type: Sequelize.BOOLEAN, defaultValue: false },
      queue_entry_id: {
        type: Sequelize.CHAR(36),
        allowNull: true,
        references: { model: 'queue_entries', key: 'id' },
      },
      imaging_notes: { type: Sequelize.TEXT, allowNull: true },
    };

    for (const [name, definition] of Object.entries(sonarRequestColumns)) {
      await addColumnIfMissing(queryInterface, 'sonar_requests', name, definition);
    }

    await addColumnIfMissing(queryInterface, 'sonar_results', 'impression', {
      type: Sequelize.TEXT,
      allowNull: true,
    });

    const hasAwaitingReport = await enumColumnIncludes(
      queryInterface,
      'sonar_requests',
      'status',
      'awaiting_report'
    );
    if (!hasAwaitingReport) {
      await queryInterface.sequelize.query(`
        ALTER TABLE sonar_requests
        MODIFY status ENUM('pending', 'in_progress', 'awaiting_report', 'completed')
        NOT NULL DEFAULT 'pending'
      `);
    }
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE sonar_requests
      MODIFY status ENUM('pending', 'in_progress', 'completed')
      NOT NULL DEFAULT 'pending'
    `);
    await removeColumnIfExists(queryInterface, 'sonar_results', 'impression');
    await removeColumnIfExists(queryInterface, 'sonar_requests', 'imaging_notes');
    await removeColumnIfExists(queryInterface, 'sonar_requests', 'queue_entry_id');
    await removeColumnIfExists(queryInterface, 'sonar_requests', 'is_emergency');
    await removeColumnIfExists(queryInterface, 'sonar_requests', 'prep_instructions');
    await removeColumnIfExists(queryInterface, 'sonar_requests', 'diagnostic_questions');
    await removeColumnIfExists(queryInterface, 'sonar_requests', 'symptoms');
  },
};
