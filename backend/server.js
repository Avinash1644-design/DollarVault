const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

const USERS_FILE = path.join(__dirname, 'users.json');
const TRANSACTIONS_FILE = path.join(__dirname, 'transactions.json');

const ADMIN_EMAIL = 'admin@dollarvault.demo';
const ADMIN_PASSWORD = 'admin123';

// ============================================================
// DATABASE
// ============================================================

const DATABASE_URL = process.env.DATABASE_URL || '';

const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    })
  : null;


// ============================================================
// APP
// ============================================================

app.use(cors({
  origin: [
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'http://localhost:3000',
    'http://127.0.0.1:3000'
  ]
}));

app.use(express.json());

app.use(
  express.static(
    path.join(__dirname, '..', 'frontend')
  )
);


// ============================================================
// JSON FILE FUNCTIONS
// Used for local development when DATABASE_URL is not present.
// ============================================================

function readJson(file, fallback) {

  try {

    if (!fs.existsSync(file)) {
      return fallback;
    }

    const content =
      fs.readFileSync(file, 'utf8').trim();

    if (!content) {
      return fallback;
    }

    return JSON.parse(content);

  } catch (error) {

    console.error(
      `Could not read ${file}:`,
      error.message
    );

    return fallback;
  }
}


function writeJson(file, value) {

  const temporary =
    `${file}.tmp`;

  fs.writeFileSync(
    temporary,
    JSON.stringify(value, null, 2)
  );

  fs.renameSync(
    temporary,
    file
  );
}


function localUsers() {

  const value =
    readJson(
      USERS_FILE,
      []
    );

  return Array.isArray(value)
    ? value
    : (
        Array.isArray(value.users)
          ? value.users
          : []
      );
}


function localTransactions() {

  const value =
    readJson(
      TRANSACTIONS_FILE,
      []
    );

  return Array.isArray(value)
    ? value
    : (
        Array.isArray(value.transactions)
          ? value.transactions
          : []
      );
}


function saveLocalUsers(value) {

  writeJson(
    USERS_FILE,
    value
  );

}


function saveLocalTransactions(value) {

  writeJson(
    TRANSACTIONS_FILE,
    value
  );

}


// ============================================================
// HELPERS
// ============================================================

function id(prefix) {

  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

}


function amount(value) {

  return Number(value);

}


function getUserId(req) {

  return (
    (
      req.body &&
      (
        req.body.userId ||
        req.body.userID ||
        req.body.id
      )
    ) ||
    req.query.userId ||
    req.query.userID ||
    req.headers['x-user-id']
  );

}


// ============================================================
// DATABASE INITIALIZATION
// ============================================================

async function initializeDatabase() {

  if (!pool) {

    console.log(
      'DATABASE_URL not found. Using local JSON files.'
    );

    return;
  }


  console.log(
    'DATABASE_URL found. Connecting to PostgreSQL...'
  );


  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      balance NUMERIC NOT NULL DEFAULT 0,
      account_type TEXT NOT NULL DEFAULT 'Customer'
    )
  `);


  await pool.query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      customer_id TEXT,
      user_name TEXT,
      user_email TEXT,
      type TEXT NOT NULL,
      amount NUMERIC NOT NULL,
      wallet_address TEXT,
      status TEXT NOT NULL,
      date TIMESTAMPTZ NOT NULL,
      approved_at TIMESTAMPTZ,
      rejected_at TIMESTAMPTZ,
      processed_at TIMESTAMPTZ
    )
  `);


  const userCountResult =
    await pool.query(
      'SELECT COUNT(*)::int AS count FROM users'
    );


  const userCount =
    userCountResult.rows[0].count;


  /*
    Import the existing JSON data once when the
    PostgreSQL users table is empty.

    This allows your existing local customer
    accounts and transaction history to be
    transferred into PostgreSQL.
  */

  if (userCount === 0) {

    const oldUsers =
      localUsers();

    const oldTransactions =
      localTransactions();


    if (oldUsers.length > 0) {

      console.log(
        `Importing ${oldUsers.length} existing user(s) into PostgreSQL...`
      );


      for (const user of oldUsers) {

        await pool.query(
          `
          INSERT INTO users
          (
            id,
            name,
            email,
            password,
            balance,
            account_type
          )
          VALUES
          ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (id) DO NOTHING
          `,
          [
            user.id,
            user.name,
            user.email,
            user.password,
            Number(user.balance) || 0,
            user.accountType || 'Customer'
          ]
        );

      }

    }


    if (oldTransactions.length > 0) {

      console.log(
        `Importing ${oldTransactions.length} existing transaction(s) into PostgreSQL...`
      );


      for (const transaction of oldTransactions) {

        await pool.query(
          `
          INSERT INTO transactions
          (
            id,
            user_id,
            customer_id,
            user_name,
            user_email,
            type,
            amount,
            wallet_address,
            status,
            date,
            approved_at,
            rejected_at,
            processed_at
          )
          VALUES
          (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8,
            $9,
            $10,
            $11,
            $12,
            $13
          )
          ON CONFLICT (id) DO NOTHING
          `,
          [
            transaction.id,
            transaction.userId || transaction.customerId,
            transaction.customerId || transaction.userId,
            transaction.userName || '',
            transaction.userEmail || '',
            transaction.type,
            Number(transaction.amount) || 0,
            transaction.walletAddress || null,
            transaction.status || 'Pending',
            transaction.date || new Date().toISOString(),
            transaction.approvedAt || null,
            transaction.rejectedAt || null,
            transaction.processedAt || null
          ]
        );

      }

    }

  }


  console.log(
    'PostgreSQL database is ready.'
  );

}


// ============================================================
// USER DATABASE FUNCTIONS
// ============================================================

async function getAllUsers() {

  if (!pool) {
    return localUsers();
  }


  const result =
    await pool.query(
      `
      SELECT
        id,
        name,
        email,
        password,
        balance,
        account_type AS "accountType"
      FROM users
      ORDER BY name ASC
      `
    );


  return result.rows.map(
    user => ({
      ...user,
      balance: Number(user.balance) || 0
    })
  );

}


async function getUserById(userId) {

  if (!pool) {

    return localUsers().find(
      user =>
        String(user.id) ===
        String(userId)
    );

  }


  const result =
    await pool.query(
      `
      SELECT
        id,
        name,
        email,
        password,
        balance,
        account_type AS "accountType"
      FROM users
      WHERE id = $1
      LIMIT 1
      `,
      [String(userId)]
    );


  if (!result.rows.length) {
    return undefined;
  }


  const user =
    result.rows[0];


  return {
    ...user,
    balance:
      Number(user.balance) || 0
  };

}


async function getUserByEmail(email) {

  if (!pool) {

    return localUsers().find(
      user =>
        String(user.email).toLowerCase() ===
        String(email || '').toLowerCase()
    );

  }


  const result =
    await pool.query(
      `
      SELECT
        id,
        name,
        email,
        password,
        balance,
        account_type AS "accountType"
      FROM users
      WHERE LOWER(email) = LOWER($1)
      LIMIT 1
      `,
      [String(email || '')]
    );


  if (!result.rows.length) {
    return undefined;
  }


  const user =
    result.rows[0];


  return {
    ...user,
    balance:
      Number(user.balance) || 0
  };

}


async function createUser(user) {

  if (!pool) {

    const list =
      localUsers();

    list.push(user);

    saveLocalUsers(list);

    return user;
  }


  await pool.query(
    `
    INSERT INTO users
    (
      id,
      name,
      email,
      password,
      balance,
      account_type
    )
    VALUES
    ($1, $2, $3, $4, $5, $6)
    `,
    [
      user.id,
      user.name,
      user.email,
      user.password,
      Number(user.balance) || 0,
      user.accountType || 'Customer'
    ]
  );


  return user;

}


async function updateUserBalance(
  userId,
  newBalance
) {

  if (!pool) {

    const list =
      localUsers();


    const user =
      list.find(
        item =>
          String(item.id) ===
          String(userId)
      );


    if (!user) {
      return undefined;
    }


    user.balance =
      Number(newBalance) || 0;


    saveLocalUsers(list);


    return user;
  }


  const result =
    await pool.query(
      `
      UPDATE users
      SET balance = $1
      WHERE id = $2
      RETURNING
        id,
        name,
        email,
        password,
        balance,
        account_type AS "accountType"
      `,
      [
        Number(newBalance) || 0,
        String(userId)
      ]
    );


  if (!result.rows.length) {
    return undefined;
  }


  const user =
    result.rows[0];


  return {
    ...user,
    balance:
      Number(user.balance) || 0
  };

}


// ============================================================
// TRANSACTION DATABASE FUNCTIONS
// ============================================================

function transactionFromRow(row) {

  return {

    id:
      row.id,

    userId:
      row.user_id,

    customerId:
      row.customer_id || row.user_id,

    userName:
      row.user_name || '',

    userEmail:
      row.user_email || '',

    type:
      row.type,

    amount:
      Number(row.amount) || 0,

    ...(row.wallet_address
      ? {
          walletAddress:
            row.wallet_address
        }
      : {}),

    status:
      row.status,

    date:
      row.date,

    ...(row.approved_at
      ? {
          approvedAt:
            row.approved_at
        }
      : {}),

    ...(row.rejected_at
      ? {
          rejectedAt:
            row.rejected_at
        }
      : {}),

    ...(row.processed_at
      ? {
          processedAt:
            row.processed_at
        }
      : {})

  };

}


async function getAllTransactions() {

  if (!pool) {
    return localTransactions();
  }


  const result =
    await pool.query(
      `
      SELECT *
      FROM transactions
      ORDER BY date DESC
      `
    );


  return result.rows.map(
    transactionFromRow
  );

}


async function createTransaction(
  transaction
) {

  if (!pool) {

    const list =
      localTransactions();

    list.push(transaction);

    saveLocalTransactions(list);

    return transaction;
  }


  await pool.query(
    `
    INSERT INTO transactions
    (
      id,
      user_id,
      customer_id,
      user_name,
      user_email,
      type,
      amount,
      wallet_address,
      status,
      date,
      approved_at,
      rejected_at,
      processed_at
    )
    VALUES
    (
      $1,
      $2,
      $3,
      $4,
      $5,
      $6,
      $7,
      $8,
      $9,
      $10,
      $11,
      $12,
      $13
    )
    `,
    [
      transaction.id,
      transaction.userId,
      transaction.customerId || transaction.userId,
      transaction.userName || '',
      transaction.userEmail || '',
      transaction.type,
      Number(transaction.amount) || 0,
      transaction.walletAddress || null,
      transaction.status || 'Pending',
      transaction.date || new Date().toISOString(),
      transaction.approvedAt || null,
      transaction.rejectedAt || null,
      transaction.processedAt || null
    ]
  );


  return transaction;

}


async function getTransactionById(
  transactionId
) {

  if (!pool) {

    return localTransactions().find(
      transaction =>
        String(transaction.id) ===
        String(transactionId)
    );

  }


  const result =
    await pool.query(
      `
      SELECT *
      FROM transactions
      WHERE id = $1
      LIMIT 1
      `,
      [String(transactionId)]
    );


  if (!result.rows.length) {
    return undefined;
  }


  return transactionFromRow(
    result.rows[0]
  );

}


async function updateTransactionStatus(
  transactionId,
  status,
  fields = {}
) {

  if (!pool) {

    const list =
      localTransactions();


    const transaction =
      list.find(
        item =>
          String(item.id) ===
          String(transactionId)
      );


    if (!transaction) {
      return undefined;
    }


    transaction.status =
      status;


    if (fields.approvedAt) {
      transaction.approvedAt =
        fields.approvedAt;
    }


    if (fields.rejectedAt) {
      transaction.rejectedAt =
        fields.rejectedAt;
    }


    if (fields.processedAt) {
      transaction.processedAt =
        fields.processedAt;
    }


    saveLocalTransactions(list);


    return transaction;
  }


  const result =
    await pool.query(
      `
      UPDATE transactions
      SET
        status = $1,
        approved_at = COALESCE($2, approved_at),
        rejected_at = COALESCE($3, rejected_at),
        processed_at = COALESCE($4, processed_at)
      WHERE id = $5
      RETURNING *
      `,
      [
        status,
        fields.approvedAt || null,
        fields.rejectedAt || null,
        fields.processedAt || null,
        String(transactionId)
      ]
    );


  if (!result.rows.length) {
    return undefined;
  }


  return transactionFromRow(
    result.rows[0]
  );

}


// ============================================================
// CUSTOMER REGISTER
// ============================================================

app.post(
  '/api/register',
  async (req, res) => {

    try {

      const {
        name,
        email,
        password
      } = req.body || {};


      if (
        !name ||
        !email ||
        !password
      ) {

        return res.status(400).json({
          success: false,
          message:
            'Name, email and password are required.'
        });

      }


      const existingUser =
        await getUserByEmail(email);


      if (existingUser) {

        return res.status(409).json({
          success: false,
          message:
            'An account with that email already exists.'
        });

      }


      const user = {

        id:
          id('user'),

        name:
          String(name).trim(),

        email:
          String(email).trim(),

        password,

        balance:
          0,

        accountType:
          'Customer'

      };


      await createUser(user);


      res.status(201).json({

        success: true,

        user: {
          ...user
        }

      });

    } catch (error) {

      console.error(
        'REGISTER ERROR:',
        error
      );


      res.status(500).json({

        success: false,

        message:
          'Unable to create account.'

      });

    }

  }
);


// ============================================================
// CUSTOMER LOGIN
// ============================================================

app.post(
  '/api/login',
  async (req, res) => {

    try {

      const {
        email,
        password
      } = req.body || {};


      const user =
        await getUserByEmail(email);


      if (
        !user ||
        user.password !== password
      ) {

        return res.status(401).json({

          success: false,

          message:
            'Invalid email or password.'

        });

      }


      res.json({

        success: true,

        user: {

          id:
            user.id,

          name:
            user.name,

          email:
            user.email,

          balance:
            Number(user.balance) || 0,

          accountType:
            user.accountType || 'Customer'

        }

      });

    } catch (error) {

      console.error(
        'LOGIN ERROR:',
        error
      );


      res.status(500).json({

        success: false,

        message:
          'Unable to login.'

      });

    }

  }
);


// ============================================================
// ADMIN LOGIN
// ============================================================

app.post(
  '/api/admin/login',
  (req, res) => {

    const {
      email,
      password
    } = req.body || {};


    if (
      email !== ADMIN_EMAIL ||
      password !== ADMIN_PASSWORD
    ) {

      return res.status(401).json({

        success: false,

        message:
          'Invalid administrator credentials.'

      });

    }


    res.json({

      success: true,

      admin: {

        email:
          ADMIN_EMAIL,

        name:
          'DollarVault Admin',

        accountType:
          'Admin'

      }

    });

  }
);


// ============================================================
// CUSTOMER BALANCE
// ============================================================

app.get(
  '/api/customer/balance',
  async (req, res) => {

    try {

      const userId =
        getUserId(req);


      const user =
        await getUserById(userId);


      if (!user) {

        return res.status(401).json({

          success: false,

          message:
            'Customer not found.'

        });

      }


      res.json({

        balance:
          Number(user.balance) || 0

      });

    } catch (error) {

      console.error(
        'BALANCE ERROR:',
        error
      );


      res.status(500).json({

        success: false,

        message:
          'Unable to load balance.'

      });

    }

  }
);


// ============================================================
// CUSTOMER TRANSACTIONS
// ============================================================

app.get(
  '/api/customer/transactions',
  async (req, res) => {

    try {

      const userId =
        getUserId(req);


      const user =
        await getUserById(userId);


      if (!user) {

        return res.status(401).json({

          success: false,

          message:
            'Customer not found.'

        });

      }


      const list =
        await getAllTransactions();


      res.json(

        list.filter(

          transaction =>

            String(
              transaction.userId ||
              transaction.customerId
            ) ===
            String(user.id)

        )

      );

    } catch (error) {

      console.error(
        'CUSTOMER TRANSACTIONS ERROR:',
        error
      );


      res.status(500).json({

        success: false,

        message:
          'Unable to load transactions.'

      });

    }

  }
);


// ============================================================
// CUSTOMER DEPOSIT
// ============================================================

app.post(
  '/api/deposit',
  async (req, res) => {

    try {

      const userId =
        getUserId(req);


      const user =
        await getUserById(userId);


      const value =
        amount(
          req.body &&
          (
            req.body.amount ||
            req.body.depositAmount
          )
        );


      if (!user) {

        return res.status(401).json({

          success: false,

          message:
            'Customer not found.'

        });

      }


      if (
        !Number.isFinite(value) ||
        value <= 0
      ) {

        return res.status(400).json({

          success: false,

          message:
            'Amount must be greater than zero.'

        });

      }


      const transaction = {

        id:
          id('txn'),

        userId:
          user.id,

        customerId:
          user.id,

        userName:
          user.name,

        userEmail:
          user.email,

        type:
          'Deposit',

        amount:
          value,

        status:
          'Pending',

        date:
          new Date().toISOString()

      };


      await createTransaction(
        transaction
      );


      res.json({

        success: true,

        message:
          'Deposit submitted for admin approval.',

        transaction,

        balance:
          Number(user.balance) || 0

      });

    } catch (error) {

      console.error(
        'DEPOSIT ERROR:',
        error
      );


      res.status(500).json({

        success: false,

        message:
          'Unable to submit deposit.'

      });

    }

  }
);


// ============================================================
// CUSTOMER WITHDRAWAL
// ============================================================

app.post(
  '/api/withdraw',
  async (req, res) => {

    try {

      const userId =
        getUserId(req);


      const user =
        await getUserById(userId);


      const value =
        amount(
          req.body &&
          (
            req.body.amount ||
            req.body.withdrawalAmount
          )
        );


      const walletAddress =
        String(
          req.body &&
          req.body.walletAddress
            ? req.body.walletAddress
            : ''
        ).trim();


      if (!user) {

        return res.status(401).json({

          success: false,

          message:
            'Customer not found.'

        });

      }


      if (
        !Number.isFinite(value) ||
        value <= 0
      ) {

        return res.status(400).json({

          success: false,

          message:
            'Amount must be greater than zero.'

        });

      }


      if (
        (Number(user.balance) || 0) <
        value
      ) {

        return res.status(400).json({

          success: false,

          message:
            'Insufficient balance.'

        });

      }


      if (!walletAddress) {

        return res.status(400).json({

          success: false,

          message:
            'Destination wallet address is required.'

        });

      }


      const transaction = {

        id:
          id('txn'),

        userId:
          user.id,

        customerId:
          user.id,

        userName:
          user.name,

        userEmail:
          user.email,

        type:
          'Withdrawal',

        amount:
          value,

        walletAddress:
          walletAddress,

        status:
          'Pending',

        date:
          new Date().toISOString()

      };


      await createTransaction(
        transaction
      );


      res.json({

        success: true,

        message:
          'Withdrawal request submitted successfully.',

        transaction

      });

    } catch (error) {

      console.error(
        'WITHDRAW ERROR:',
        error
      );


      res.status(500).json({

        success: false,

        message:
          'Unable to submit withdrawal.'

      });

    }

  }
);


// ============================================================
// ADMIN STATS
// ============================================================

app.get(
  '/api/admin/stats',
  async (req, res) => {

    try {

      const list =
        await getAllUsers();

      const txns =
        await getAllTransactions();


      res.json({

        totalCustomers:

          list.filter(
            user =>
              (
                user.accountType ||
                'Customer'
              ) === 'Customer'
          ).length,


        totalDeposits:

          txns
            .filter(
              transaction =>
                transaction.type === 'Deposit' &&
                transaction.status === 'Completed'
            )
            .reduce(
              (sum, transaction) =>
                sum +
                (Number(transaction.amount) || 0),
              0
            ),


        totalWithdrawals:

          txns
            .filter(
              transaction =>
                transaction.type === 'Withdrawal' &&
                transaction.status === 'Completed'
            )
            .reduce(
              (sum, transaction) =>
                sum +
                (Number(transaction.amount) || 0),
              0
            ),


        demoWalletValue:

          list.reduce(
            (sum, user) =>
              sum +
              (Number(user.balance) || 0),
            0
          )

      });

    } catch (error) {

      console.error(
        'ADMIN STATS ERROR:',
        error
      );


      res.status(500).json({

        success: false,

        message:
          'Unable to load admin statistics.'

      });

    }

  }
);


// ============================================================
// ADMIN CUSTOMERS
// ============================================================

app.get(
  '/api/admin/customers',
  async (req, res) => {

    try {

      const list =
        await getAllUsers();


      res.json(

        list.filter(

          user =>
            (
              user.accountType ||
              'Customer'
            ) === 'Customer'

        )

      );

    } catch (error) {

      console.error(
        'ADMIN CUSTOMERS ERROR:',
        error
      );


      res.status(500).json({

        success: false,

        message:
          'Unable to load customers.'

      });

    }

  }
);


// ============================================================
// ADMIN DEPOSITS
// ============================================================

app.get(
  '/api/admin/deposits',
  async (req, res) => {

    try {

      const list =
        await getAllTransactions();


      res.json(

        list.filter(
          transaction =>
            transaction.type === 'Deposit'
        )

      );

    } catch (error) {

      console.error(
        'ADMIN DEPOSITS ERROR:',
        error
      );


      res.status(500).json({

        success: false,

        message:
          'Unable to load deposits.'

      });

    }

  }
);


// ============================================================
// ADMIN APPROVE DEPOSIT
// ============================================================

app.post(
  '/api/admin/deposits/:id/approve',
  async (req, res) => {

    if (!pool) {

      try {

        const txns =
          localTransactions();


        const transaction =
          txns.find(
            item =>
              item.id === req.params.id &&
              item.type === 'Deposit'
          );


        if (!transaction) {

          return res.status(404).json({

            success: false,

            message:
              'Deposit transaction not found.'

          });

        }


        if (
          transaction.status !== 'Pending'
        ) {

          return res.status(400).json({

            success: false,

            message:
              'Only pending deposits can be approved.'

          });

        }


        const list =
          localUsers();


        const user =
          list.find(
            item =>
              item.id === transaction.userId
          );


        if (!user) {

          return res.status(404).json({

            success: false,

            message:
              'Customer not found.'

          });

        }


        const depositAmount =
          Number(transaction.amount) || 0;


        user.balance =
          (Number(user.balance) || 0) +
          depositAmount;


        transaction.status =
          'Completed';


        transaction.approvedAt =
          new Date().toISOString();


        saveLocalUsers(list);

        saveLocalTransactions(txns);


        return res.json({

          success: true,

          message:
            'Deposit approved successfully.',

          transaction,

          balance:
            user.balance

        });

      } catch (error) {

        console.error(
          'APPROVE DEPOSIT ERROR:',
          error
        );


        return res.status(500).json({

          success: false,

          message:
            'Unable to approve deposit.'

        });

      }

    }


    const client =
      await pool.connect();


    try {

      await client.query(
        'BEGIN'
      );


      const transactionResult =
        await client.query(
          `
          SELECT *
          FROM transactions
          WHERE id = $1
            AND type = 'Deposit'
          FOR UPDATE
          `,
          [req.params.id]
        );


      if (!transactionResult.rows.length) {

        await client.query(
          'ROLLBACK'
        );


        return res.status(404).json({

          success: false,

          message:
            'Deposit transaction not found.'

        });

      }


      const transaction =
        transactionResult.rows[0];


      if (
        transaction.status !== 'Pending'
      ) {

        await client.query(
          'ROLLBACK'
        );


        return res.status(400).json({

          success: false,

          message:
            'Only pending deposits can be approved.'

        });

      }


      const depositAmount =
        Number(transaction.amount) || 0;


      const userResult =
        await client.query(
          `
          UPDATE users
          SET balance = balance + $1
          WHERE id = $2
          RETURNING
            id,
            name,
            email,
            balance,
            account_type AS "accountType"
          `,
          [
            depositAmount,
            transaction.user_id
          ]
        );


      if (!userResult.rows.length) {

        await client.query(
          'ROLLBACK'
        );


        return res.status(404).json({

          success: false,

          message:
            'Customer not found.'

        });

      }


      const approvedAt =
        new Date().toISOString();


      const updatedResult =
        await client.query(
          `
          UPDATE transactions
          SET
            status = 'Completed',
            approved_at = $1
          WHERE id = $2
          RETURNING *
          `,
          [
            approvedAt,
            req.params.id
          ]
        );


      await client.query(
        'COMMIT'
      );


      res.json({

        success: true,

        message:
          'Deposit approved successfully.',

        transaction:
          transactionFromRow(
            updatedResult.rows[0]
          ),

        balance:
          Number(
            userResult.rows[0].balance
          ) || 0

      });

    } catch (error) {

      await client.query(
        'ROLLBACK'
      );


      console.error(
        'APPROVE DEPOSIT ERROR:',
        error
      );


      res.status(500).json({

        success: false,

        message:
          'Unable to approve deposit.'

      });

    } finally {

      client.release();

    }

  }
);


// ============================================================
// ADMIN REJECT DEPOSIT
// ============================================================

app.post(
  '/api/admin/deposits/:id/reject',
  async (req, res) => {

    try {

      const transaction =
        await getTransactionById(
          req.params.id
        );


      if (
        !transaction ||
        transaction.type !== 'Deposit'
      ) {

        return res.status(404).json({

          success: false,

          message:
            'Deposit transaction not found.'

        });

      }


      if (
        transaction.status !== 'Pending'
      ) {

        return res.status(400).json({

          success: false,

          message:
            'Only pending deposits can be rejected.'

        });

      }


      const rejectedAt =
        new Date().toISOString();


      const updated =
        await updateTransactionStatus(
          req.params.id,
          'Rejected',
          {
            rejectedAt
          }
        );


      res.json({

        success: true,

        message:
          'Deposit rejected successfully.',

        transaction:
          updated

      });

    } catch (error) {

      console.error(
        'REJECT DEPOSIT ERROR:',
        error
      );


      res.status(500).json({

        success: false,

        message:
          'Unable to reject deposit.'

      });

    }

  }
);


// ============================================================
// ADMIN WITHDRAWALS
// ============================================================

app.get(
  '/api/admin/withdrawals',
  async (req, res) => {

    try {

      const list =
        await getAllTransactions();


      res.json(

        list.filter(
          transaction =>
            transaction.type === 'Withdrawal'
        )

      );

    } catch (error) {

      console.error(
        'ADMIN WITHDRAWALS ERROR:',
        error
      );


      res.status(500).json({

        success: false,

        message:
          'Unable to load withdrawals.'

      });

    }

  }
);


// ============================================================
// ADMIN PROCESS WITHDRAWAL
// ============================================================

async function updateWithdrawal(
  req,
  res,
  status
) {

  if (!pool) {

    try {

      const txns =
        localTransactions();


      const transaction =
        txns.find(

          item =>

            String(item.id) ===
            String(req.params.id) &&

            item.type ===
            'Withdrawal' &&

            item.status ===
            'Pending'

        );


      if (!transaction) {

        return res.status(404).json({

          success: false,

          message:
            'Pending withdrawal not found.'

        });

      }


      if (
        status === 'Completed'
      ) {

        const list =
          localUsers();


        const user =
          list.find(

            item =>

              String(item.id) ===
              String(
                transaction.userId ||
                transaction.customerId
              )

          );


        if (
          !user ||
          (
            Number(user.balance) || 0
          ) <
          Number(transaction.amount)
        ) {

          return res.status(400).json({

            success: false,

            message:
              'Insufficient balance.'

          });

        }


        user.balance =

          (Number(user.balance) || 0) -
          Number(transaction.amount);


        saveLocalUsers(
          list
        );

      }


      transaction.status =
        status;


      transaction.processedAt =
        new Date().toISOString();


      saveLocalTransactions(
        txns
      );


      return res.json({

        success: true,

        transaction

      });

    } catch (error) {

      console.error(
        'WITHDRAWAL UPDATE ERROR:',
        error
      );


      return res.status(500).json({

        success: false,

        message:
          'Unable to process withdrawal.'

      });

    }

  }


  const client =
    await pool.connect();


  try {

    await client.query(
      'BEGIN'
    );


    const transactionResult =
      await client.query(
        `
        SELECT *
        FROM transactions
        WHERE id = $1
          AND type = 'Withdrawal'
          AND status = 'Pending'
        FOR UPDATE
        `,
        [req.params.id]
      );


    if (!transactionResult.rows.length) {

      await client.query(
        'ROLLBACK'
      );


      return res.status(404).json({

        success: false,

        message:
          'Pending withdrawal not found.'

      });

    }


    const transaction =
      transactionResult.rows[0];


    if (
      status === 'Completed'
    ) {

      const withdrawalAmount =
        Number(transaction.amount) || 0;


      const userResult =
        await client.query(
          `
          UPDATE users
          SET balance = balance - $1
          WHERE id = $2
            AND balance >= $1
          RETURNING
            id,
            balance
          `,
          [
            withdrawalAmount,
            transaction.user_id
          ]
        );


      if (!userResult.rows.length) {

        await client.query(
          'ROLLBACK'
        );


        return res.status(400).json({

          success: false,

          message:
            'Insufficient balance.'

        });

      }

    }


    const processedAt =
      new Date().toISOString();


    const updatedResult =
      await client.query(
        `
        UPDATE transactions
        SET
          status = $1,
          processed_at = $2
        WHERE id = $3
        RETURNING *
        `,
        [
          status,
          processedAt,
          req.params.id
        ]
      );


    await client.query(
      'COMMIT'
    );


    res.json({

      success: true,

      transaction:
        transactionFromRow(
          updatedResult.rows[0]
        )

    });

  } catch (error) {

    await client.query(
      'ROLLBACK'
    );


    console.error(
      'WITHDRAWAL UPDATE ERROR:',
      error
    );


    res.status(500).json({

      success: false,

      message:
        'Unable to process withdrawal.'

    });

  } finally {

    client.release();

  }

}


// ============================================================
// APPROVE WITHDRAWAL
// ============================================================

app.post(
  '/api/admin/withdrawals/:id/approve',
  (req, res) => {

    updateWithdrawal(
      req,
      res,
      'Completed'
    );

  }
);


// ============================================================
// REJECT WITHDRAWAL
// ============================================================

app.post(
  '/api/admin/withdrawals/:id/reject',
  (req, res) => {

    updateWithdrawal(
      req,
      res,
      'Rejected'
    );

  }
);


// ============================================================
// HEALTH CHECK
// ============================================================

app.get(
  '/api/health',
  async (req, res) => {

    try {

      if (pool) {

        await pool.query(
          'SELECT 1'
        );

        return res.json({
          success: true,
          database: 'PostgreSQL',
          status: 'connected'
        });

      }


      res.json({
        success: true,
        database: 'JSON files',
        status: 'connected'
      });

    } catch (error) {

      res.status(500).json({

        success: false,

        database:
          'PostgreSQL',

        status:
          'error'

      });

    }

  }
);


// ============================================================
// START SERVER
// ============================================================

async function startServer() {

  try {

    await initializeDatabase();


    app.listen(
      PORT,
      () => {

        console.log(
          `DollarVault backend is running on port ${PORT}`
        );

      }
    );

  } catch (error) {

    console.error(
      'DATABASE STARTUP ERROR:',
      error
    );


    process.exit(1);

  }

}


startServer();