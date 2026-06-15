'use strict';

/** Roll back only when the transaction is still open (avoids crash after commit). */
async function safeRollback(transaction) {
  if (transaction && !transaction.finished) {
    await transaction.rollback();
  }
}

module.exports = { safeRollback };
