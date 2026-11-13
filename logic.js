// logic.js - all money calculations. No screen, no Google code, so it can be tested on its own.
(function (root) {
  const DAY = 864e5;

  function pad(n) { return String(n).padStart(2, '0'); }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseDay(s) { const p = String(s).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function todayStr() { return ymd(new Date()); }
  function monthOf(s) { return String(s).slice(0, 7); }
  function num(x) { return Number(x) || 0; }

  function defaultData() {
    return {
      version: 1,
      accounts: ['Pocket', 'CCP', 'Ghardaia'],
      buckets: [
        { name: 'Necessary', pct: 0.07667 }, { name: 'Needs', pct: 0.06111 },
        { name: 'Wants', pct: 0.03333 }, { name: 'Savings', pct: 0.66667 },
        { name: 'Overflow', pct: 0.10667 }, { name: 'Sadaka', pct: 0.02222 },
        { name: 'Gifts', pct: 0.01111 }, { name: 'Mama', pct: 0.02222 }
      ],
      expenseTypes: [
        { name: 'Groceries', bucket: 'Needs' }, { name: 'Transport / fuel', bucket: 'Needs' },
        { name: 'Bills (electricity, water, internet)', bucket: 'Needs' }, { name: 'Rent', bucket: 'Necessary' },
        { name: 'Health', bucket: 'Necessary' }, { name: 'Eating out / coffee', bucket: 'Wants' },
        { name: 'Clothes', bucket: 'Wants' }, { name: 'Entertainment', bucket: 'Wants' },
        { name: 'Gifts', bucket: 'Gifts' }, { name: 'Sadaka', bucket: 'Sadaka' },
        { name: 'Mama', bucket: 'Mama' }, { name: 'Other', bucket: 'Wants' }
      ],
      people: [],
      txs: [],
      bills: [],
      goals: []
    };
  }

  // Transaction kinds:
  //  income   : account +, bucket allocated        (fields: account, bucket)
  //  expense  : account -, bucket spent            (fields: account, bucket, billId?)
  //  borrow   : account +, you owe the person      (fields: account, person)
  //  repay    : account -, you paid the person     (fields: account, person)
  //  goal     : account -, saved toward a goal     (fields: account, goal)
  //  transfer : from account -, to account +       (fields: from, to)

  function accountBalance(data, acc) {
    let b = 0;
    for (const t of data.txs) {
      const a = num(t.amount);
      if (t.kind === 'transfer') {
        if (t.from === acc) b -= a;
        if (t.to === acc) b += a;
      } else if (t.account === acc) {
        if (t.kind === 'income' || t.kind === 'borrow') b += a;
        else if (t.kind === 'expense' || t.kind === 'repay' || t.kind === 'goal') b -= a;
      }
    }
    return b;
  }

  function bucketStats(data, bucket, month) {
    let allocated = 0, spent = 0;
    for (const t of data.txs) {
      if (month && monthOf(t.date) !== month) continue;
      if (t.bucket !== bucket) continue;
      if (t.kind === 'income') allocated += num(t.amount);
      if (t.kind === 'expense') spent += num(t.amount);
    }
    return { allocated: allocated, spent: spent, left: allocated - spent };
  }

  function debtFor(data, person) {
    let borrowed = 0, paid = 0;
    for (const t of data.txs) {
      if (t.person !== person) continue;
      if (t.kind === 'borrow') borrowed += num(t.amount);
      if (t.kind === 'repay') paid += num(t.amount);
    }
    const owed = borrowed - paid;
    return { person: person, borrowed: borrowed, paid: paid, owed: owed, pct: borrowed > 0 ? owed / borrowed : null };
  }

  function debts(data) { return data.people.map(p => debtFor(data, p)); }

  function goalSaved(data, goal) {
    return data.txs.filter(t => t.kind === 'goal' && t.goal === goal).reduce((a, t) => a + num(t.amount), 0);
  }

  function monthsUntil(deadlineStr, todayS) {
    const d = parseDay(deadlineStr), t = parseDay(todayS);
    return Math.max(1, (d.getFullYear() - t.getFullYear()) * 12 + d.getMonth() - t.getMonth() + 1);
  }

  function goalList(data, todayS) {
    return data.goals.map(g => {
      const saved = goalSaved(data, g.name);
      const still = Math.max(0, num(g.target) - saved);
      return {
        id: g.id, name: g.name, target: num(g.target), saved: saved, still: still,
        pct: num(g.target) > 0 ? Math.min(1, saved / num(g.target)) : 0,
        deadline: g.deadline || '',
        perMonth: g.deadline && still > 0 ? still / monthsUntil(g.deadline, todayS) : 0
      };
    });
  }

  function billStatus(data, bill, todayS) {
    const m = monthOf(todayS);
    const paid = data.txs.some(t => t.kind === 'expense' && t.billId === bill.id && monthOf(t.date) === m);
    const today = parseDay(todayS);
    const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const due = new Date(today.getFullYear(), today.getMonth(), Math.min(num(bill.day), lastDay));
    const daysLeft = Math.round((due - today) / DAY);
    const status = paid ? 'Paid' : daysLeft < 0 ? 'Overdue' : daysLeft <= 3 ? 'Due soon' : 'Upcoming';
    return { paid: paid, dueDate: ymd(due), daysLeft: daysLeft, status: status };
  }

  function bucketStatus(planned, spent) {
    if (planned <= 0) return spent > 0 ? 'Over' : 'None';
    if (spent > planned) return 'Over';
    if (spent >= 0.8 * planned) return 'Close';
    return 'OK';
  }

  function monthSummary(data, m) {
    const txs = data.txs.filter(t => monthOf(t.date) === m);
    const sum = (kind, pred) => txs.filter(t => t.kind === kind && (!pred || pred(t)))
      .reduce((a, t) => a + num(t.amount), 0);
    const income = sum('income');
    const borrowed = sum('borrow');
    const repaid = sum('repay');
    const toGoals = sum('goal');
    const buckets = data.buckets.map(b => {
      const planned = b.pct * income;
      const spent = sum('expense', t => t.bucket === b.name);
      return { name: b.name, pct: b.pct, planned: planned, spent: spent, left: planned - spent,
               used: planned > 0 ? spent / planned : null, status: bucketStatus(planned, spent) };
    });
    const spending = buckets.reduce((a, b) => a + b.spent, 0);
    const out = spending + repaid + toGoals;
    const kept = income - out;
    return {
      month: m, income: income, borrowed: borrowed, repaid: repaid, toGoals: toGoals,
      spending: spending, out: out, kept: kept, keptPct: income > 0 ? kept / income : null,
      buckets: buckets
    };
  }

  function totals(data) {
    const accounts = data.accounts.map(a => ({ name: a, balance: accountBalance(data, a) }));
    const totalAccounts = accounts.reduce((a, x) => a + x.balance, 0);
    const owed = debts(data).reduce((a, d) => a + d.owed, 0);
    const saved = goalList(data, todayStr()).reduce((a, g) => a + g.saved, 0);
    return { accounts: accounts, totalAccounts: totalAccounts, owed: owed, saved: saved,
             netPosition: totalAccounts - owed };
  }

  const api = {
    DAY, pad, ymd, parseDay, todayStr, monthOf, num, defaultData,
    accountBalance, bucketStats, debtFor, debts, goalSaved, goalList,
    billStatus, monthSummary, totals, bucketStatus
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.FinLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
