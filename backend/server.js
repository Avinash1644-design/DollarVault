const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;
const USERS_FILE = path.join(__dirname, 'users.json');
const TRANSACTIONS_FILE = path.join(__dirname, 'transactions.json');
const ADMIN_EMAIL = 'admin@dollarvault.demo';
const ADMIN_PASSWORD = 'admin123';

app.use(cors({
  origin: ['http://localhost:5500', 'http://127.0.0.1:5500']
}));
app.use(express.json());

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const content = fs.readFileSync(file, 'utf8').trim();
    if (!content) return fallback;
    const value = JSON.parse(content);
    return value;
  } catch (error) {
    return fallback;
  }
}

function writeJson(file, value) {
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
  fs.renameSync(temporary, file);
}

function users() {
  const value = readJson(USERS_FILE, []);
  return Array.isArray(value) ? value : (Array.isArray(value.users) ? value.users : []);
}

function transactions() {
  const value = readJson(TRANSACTIONS_FILE, []);
  return Array.isArray(value) ? value : (Array.isArray(value.transactions) ? value.transactions : []);
}

function saveUsers(value) { writeJson(USERS_FILE, value); }
function saveTransactions(value) { writeJson(TRANSACTIONS_FILE, value); }
function id(prefix) { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }
function amount(value) { return Number(value); }

function getUser(req, list) {
  const userId = req.body && (req.body.userId || req.body.userID || req.body.id) || req.query.userId || req.query.userID || req.headers['x-user-id'];
  return list.find(user => String(user.id) === String(userId));
}

app.get('/', (req, res) => res.send('DollarVault backend is running.'));

app.post('/api/register', (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ success: false, message: 'Name, email and password are required.' });
  const list = users();
  if (list.some(user => String(user.email).toLowerCase() === String(email).toLowerCase())) return res.status(409).json({ success: false, message: 'An account with that email already exists.' });
  const user = { id: id('user'), name, email, password, balance: 0, accountType: 'Customer' };
  list.push(user);
  saveUsers(list);
  res.status(201).json({ success: true, user: { ...user } });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = users().find(item => String(item.email).toLowerCase() === String(email || '').toLowerCase() && item.password === password);
  if (!user) return res.status(401).json({ success: false, message: 'Invalid email or password.' });
  res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, balance: Number(user.balance) || 0, accountType: user.accountType || 'Customer' } });
});

app.post('/api/admin/login', (req, res) => {
  const { email, password } = req.body || {};
  if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) return res.status(401).json({ success: false, message: 'Invalid administrator credentials.' });
  res.json({ success: true, admin: { email: ADMIN_EMAIL, name: 'DollarVault Admin', accountType: 'Admin' } });
});

app.get('/api/customer/balance', (req, res) => {
  const user = getUser(req, users());
  if (!user) return res.status(401).json({ success: false, message: 'Customer not found.' });
  res.json({ balance: Number(user.balance) || 0 });
});

app.get('/api/customer/transactions', (req, res) => {
  const user = getUser(req, users());
  if (!user) return res.status(401).json({ success: false, message: 'Customer not found.' });
  res.json(transactions().filter(transaction => String(transaction.userId || transaction.customerId) === String(user.id)));
});

app.post('/api/deposit', (req, res) => {

const list = users();

const user = getUser(req, list);

const value = amount(
req.body && (req.body.amount || req.body.depositAmount)
);

if (!user) {
return res.status(401).json({
success: false,
message: 'Customer not found.'
});
}

if (!Number.isFinite(value) || value <= 0) {
return res.status(400).json({
success: false,
message: 'Amount must be greater than zero.'
});
}

// Deposit remains pending until admin approval.
// Customer balance is NOT increased here.

const transaction = {
id: id('txn'),
userId: user.id,
customerId: user.id,
userName: user.name,
userEmail: user.email,
type: 'Deposit',
amount: value,
status: 'Pending',
date: new Date().toISOString()
};

const txns = transactions();

txns.push(transaction);

saveTransactions(txns);

res.json({
success: true,
message: 'Deposit submitted for admin approval.',
transaction,
balance: Number(user.balance) || 0
});

});


app.post('/api/withdraw', (req, res) => {
  const list = users();
  const user = getUser(req, list);
  const value = amount(req.body && (req.body.amount || req.body.withdrawalAmount));
  if (!user) return res.status(401).json({ success: false, message: 'Customer not found.' });
  if (!Number.isFinite(value) || value <= 0) return res.status(400).json({ success: false, message: 'Amount must be greater than zero.' });
  if ((Number(user.balance) || 0) < value) return res.status(400).json({ success: false, message: 'Insufficient balance.' });
  const transaction = { id: id('txn'), userId: user.id, customerId: user.id, type: 'Withdrawal', amount: value, status: 'Pending', date: new Date().toISOString() };
  const txns = transactions(); txns.push(transaction); saveTransactions(txns);
  res.json({ success: true, transaction });
});

app.get('/api/admin/stats', (req, res) => {
  const list = users(); const txns = transactions();
  res.json({ totalCustomers: list.filter(user => (user.accountType || 'Customer') === 'Customer').length, totalDeposits: txns.filter(t => t.type === 'Deposit' && t.status === 'Completed').reduce((sum, t) => sum + (Number(t.amount) || 0), 0), totalWithdrawals: txns.filter(t => t.type === 'Withdrawal' && t.status === 'Completed').reduce((sum, t) => sum + (Number(t.amount) || 0), 0), demoWalletValue: list.reduce((sum, user) => sum + (Number(user.balance) || 0), 0) });
});

app.get('/api/admin/customers', (req, res) => res.json(users().filter(user => (user.accountType || 'Customer') === 'Customer')));
app.get('/api/admin/deposits', (req, res) => res.json(transactions().filter(t => t.type === 'Deposit')));
app.post('/api/admin/deposits/:id/approve', (req, res) => {

const txns = transactions();

const transaction = txns.find(
t => t.id === req.params.id && t.type === 'Deposit'
);

if (!transaction) {
return res.status(404).json({
success: false,
message: 'Deposit transaction not found.'
});
}

if (transaction.status !== 'Pending') {
return res.status(400).json({
success: false,
message: 'Only pending deposits can be approved.'
});
}

const list = users();

const user = list.find(
u => u.id === transaction.userId
);

if (!user) {
return res.status(404).json({
success: false,
message: 'Customer not found.'
});
}

const depositAmount = Number(transaction.amount) || 0;

user.balance = (Number(user.balance) || 0) + depositAmount;

transaction.status = 'Completed';
transaction.approvedAt = new Date().toISOString();

saveUsers(list);
saveTransactions(txns);

res.json({
success: true,
message: 'Deposit approved successfully.',
transaction,
balance: user.balance
});

});

app.post('/api/admin/deposits/:id/reject', (req, res) => {

const txns = transactions();

const transaction = txns.find(
t => t.id === req.params.id && t.type === 'Deposit'
);

if (!transaction) {
return res.status(404).json({
success: false,
message: 'Deposit transaction not found.'
});
}

if (transaction.status !== 'Pending') {
return res.status(400).json({
success: false,
message: 'Only pending deposits can be rejected.'
});
}

transaction.status = 'Rejected';
transaction.rejectedAt = new Date().toISOString();

saveTransactions(txns);

res.json({
success: true,
message: 'Deposit rejected successfully.',
transaction
});

});

app.get('/api/admin/withdrawals', (req, res) => res.json(transactions().filter(t => t.type === 'Withdrawal')));

function updateWithdrawal(req, res, status) {
  const txns = transactions();
  const transaction = txns.find(t => String(t.id) === String(req.params.id) && t.type === 'Withdrawal' && t.status === 'Pending');
  if (!transaction) return res.status(404).json({ success: false, message: 'Pending withdrawal not found.' });
  if (status === 'Completed') {
    const list = users(); const user = list.find(item => String(item.id) === String(transaction.userId || transaction.customerId));
    if (!user || (Number(user.balance) || 0) < Number(transaction.amount)) return res.status(400).json({ success: false, message: 'Insufficient balance.' });
    user.balance = (Number(user.balance) || 0) - Number(transaction.amount); saveUsers(list);
  }
  transaction.status = status; transaction.processedAt = new Date().toISOString(); saveTransactions(txns);
  res.json({ success: true, transaction });
}

app.post('/api/admin/withdrawals/:id/approve', (req, res) => updateWithdrawal(req, res, 'Completed'));
app.post('/api/admin/withdrawals/:id/reject', (req, res) => updateWithdrawal(req, res, 'Rejected'));

app.listen(PORT, () => console.log(`DollarVault backend is running on port ${PORT}`));