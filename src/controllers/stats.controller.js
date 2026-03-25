const { query } = require('../config/database');
const { asyncHandler } = require('../middleware/error.middleware');

// @desc    Get dashboard statistics (une seule requête SQL)
// @route   GET /api/stats/dashboard
const getDashboardStats = asyncHandler(async (req, res) => {
  const result = await query(`
    WITH status_counts AS (
      SELECT status, COUNT(*)::bigint as count, COALESCE(SUM(amount_sent), 0)::float as total_amount
      FROM transfers
      GROUP BY status
    ),
    today_stats AS (
      SELECT
        COUNT(*)::bigint as count,
        COALESCE(SUM(amount_sent), 0)::float as total_sent,
        COALESCE(SUM(amount_received), 0)::float as total_received
      FROM transfers
      WHERE DATE(created_at) = CURRENT_DATE
    ),
    month_stats AS (
      SELECT
        COUNT(*)::bigint as count,
        COALESCE(SUM(amount_sent), 0)::float as total_sent,
        COALESCE(SUM(fees), 0)::float as total_fees
      FROM transfers
      WHERE DATE_TRUNC('month', created_at) = DATE_TRUNC('month', CURRENT_DATE)
    )
    SELECT
      (SELECT json_agg(json_build_object('status', status, 'count', count, 'total_amount', total_amount)) FROM status_counts) as by_status,
      (SELECT row_to_json(t) FROM today_stats t) as today,
      (SELECT row_to_json(m) FROM month_stats m) as month
  `);

  const row = result.rows[0];
  const statusRows = row?.by_status || [];
  const today = row?.today || {};
  const month = row?.month || {};

  const statusMap = {};
  (Array.isArray(statusRows) ? statusRows : []).forEach(s => {
    statusMap[s.status] = { count: parseInt(s.count, 10), amount: parseFloat(s.total_amount) || 0 };
  });

  const mapCurrencyRows = (rows) =>
    (rows || []).map((r) => ({
      currency: r.currency_sent,
      count: parseInt(r.cnt, 10) || 0,
      amount: parseFloat(r.total_amount) || 0,
    }));

  const mapMethodRows = (rows) =>
    (rows || []).map((r) => ({
      sendMethod: r.send_method,
      currency: r.currency_sent,
      count: parseInt(r.cnt, 10) || 0,
      amount: parseFloat(r.total_amount) || 0,
    }));

  const [
    pendingByCurrencyRes,
    pendingByMethodRes,
    pendingUsaBfCurrRes,
    pendingUsaBfMethodRes,
    pendingBfUsaCurrRes,
    pendingBfUsaMethodRes,
    todayBySentRes,
    todayByReceivedRes,
    monthByCurrencyRes,
  ] = await Promise.all([
    query(`
      SELECT currency_sent, COUNT(*)::int as cnt, COALESCE(SUM(amount_sent), 0)::float as total_amount
      FROM transfers
      WHERE status = 'pending'
      GROUP BY currency_sent
      ORDER BY currency_sent
    `),
    query(`
      SELECT send_method, currency_sent, COUNT(*)::int as cnt, COALESCE(SUM(amount_sent), 0)::float as total_amount
      FROM transfers
      WHERE status = 'pending'
      GROUP BY send_method, currency_sent
      ORDER BY send_method, currency_sent
    `),
    query(`
      SELECT currency_sent, COUNT(*)::int as cnt, COALESCE(SUM(amount_sent), 0)::float as total_amount
      FROM transfers
      WHERE status = 'pending' AND sender_country = 'USA' AND beneficiary_country = 'BFA'
      GROUP BY currency_sent
      ORDER BY currency_sent
    `),
    query(`
      SELECT send_method, currency_sent, COUNT(*)::int as cnt, COALESCE(SUM(amount_sent), 0)::float as total_amount
      FROM transfers
      WHERE status = 'pending' AND sender_country = 'USA' AND beneficiary_country = 'BFA'
      GROUP BY send_method, currency_sent
      ORDER BY send_method, currency_sent
    `),
    query(`
      SELECT currency_sent, COUNT(*)::int as cnt, COALESCE(SUM(amount_sent), 0)::float as total_amount
      FROM transfers
      WHERE status = 'pending' AND sender_country = 'BFA' AND beneficiary_country = 'USA'
      GROUP BY currency_sent
      ORDER BY currency_sent
    `),
    query(`
      SELECT send_method, currency_sent, COUNT(*)::int as cnt, COALESCE(SUM(amount_sent), 0)::float as total_amount
      FROM transfers
      WHERE status = 'pending' AND sender_country = 'BFA' AND beneficiary_country = 'USA'
      GROUP BY send_method, currency_sent
      ORDER BY send_method, currency_sent
    `),
    query(`
      SELECT currency_sent, COALESCE(SUM(amount_sent), 0)::float as total_sent
      FROM transfers
      WHERE DATE(created_at) = CURRENT_DATE
      GROUP BY currency_sent
      ORDER BY currency_sent
    `),
    query(`
      SELECT currency_received, COALESCE(SUM(amount_received), 0)::float as total_received
      FROM transfers
      WHERE DATE(created_at) = CURRENT_DATE
      GROUP BY currency_received
      ORDER BY currency_received
    `),
    query(`
      SELECT currency_sent,
        COALESCE(SUM(amount_sent), 0)::float as total_sent,
        COALESCE(SUM(fees), 0)::float as total_fees
      FROM transfers
      WHERE DATE_TRUNC('month', created_at) = DATE_TRUNC('month', CURRENT_DATE)
      GROUP BY currency_sent
      ORDER BY currency_sent
    `),
  ]);

  const todayBySent = (todayBySentRes.rows || []).map((r) => ({
    currency: r.currency_sent,
    amount: parseFloat(r.total_sent) || 0,
  }));
  const todayByReceived = (todayByReceivedRes.rows || []).map((r) => ({
    currency: r.currency_received,
    amount: parseFloat(r.total_received) || 0,
  }));
  const monthByCurrency = (monthByCurrencyRes.rows || []).map((r) => ({
    currency: r.currency_sent,
    totalSent: parseFloat(r.total_sent) || 0,
    totalFees: parseFloat(r.total_fees) || 0,
  }));

  const pendingBreakdown = {
    byCurrency: mapCurrencyRows(pendingByCurrencyRes.rows),
    byMethod: mapMethodRows(pendingByMethodRes.rows),
  };

  const sumCounts = (byCurrency) =>
    (byCurrency || []).reduce((s, r) => s + (r.count || 0), 0);

  const pendingUsaToBf = {
    count: sumCounts(mapCurrencyRows(pendingUsaBfCurrRes.rows)),
    byCurrency: mapCurrencyRows(pendingUsaBfCurrRes.rows),
    byMethod: mapMethodRows(pendingUsaBfMethodRes.rows),
  };

  const pendingBfToUsa = {
    count: sumCounts(mapCurrencyRows(pendingBfUsaCurrRes.rows)),
    byCurrency: mapCurrencyRows(pendingBfUsaCurrRes.rows),
    byMethod: mapMethodRows(pendingBfUsaMethodRes.rows),
  };

  res.json({
    success: true,
    data: {
      today: {
        transfers: parseInt(today.count, 10) || 0,
        totalSent: parseFloat(today.total_sent) || 0,
        totalReceived: parseFloat(today.total_received) || 0,
        byCurrencySent: todayBySent,
        byCurrencyReceived: todayByReceived,
      },
      month: {
        transfers: parseInt(month.count, 10) || 0,
        totalSent: parseFloat(month.total_sent) || 0,
        totalFees: parseFloat(month.total_fees) || 0,
        byCurrency: monthByCurrency,
      },
      byStatus: {
        pending: statusMap.pending || { count: 0, amount: 0 },
        inProgress: statusMap.in_progress || { count: 0, amount: 0 },
        paid: statusMap.paid || { count: 0, amount: 0 },
        cancelled: statusMap.cancelled || { count: 0, amount: 0 }
      },
      pendingBreakdown,
      pendingCorridors: {
        usaToBf: pendingUsaToBf,
        bfToUsa: pendingBfToUsa,
      },
    }
  });
});

// @desc    Get transfer statistics (for charts)
// @route   GET /api/stats/transfers
const getTransferStats = asyncHandler(async (req, res) => {
  // Get last 6 months data
  const monthlyData = await query(`
    SELECT 
      TO_CHAR(DATE_TRUNC('month', created_at), 'Mon') as month,
      COUNT(*) FILTER (WHERE status != 'cancelled') as sent,
      COUNT(*) FILTER (WHERE status = 'paid') as paid
    FROM transfers
    WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '5 months')
    GROUP BY DATE_TRUNC('month', created_at)
    ORDER BY DATE_TRUNC('month', created_at)
  `);

  // Get top corridors
  const corridors = await query(`
    SELECT 
      sender_country || ' → ' || beneficiary_country as corridor,
      COUNT(*) as count,
      SUM(amount_sent) as total_amount,
      currency_sent as currency
    FROM transfers
    WHERE status != 'cancelled'
    GROUP BY sender_country, beneficiary_country, currency_sent
    ORDER BY count DESC
    LIMIT 5
  `);

  res.json({
    success: true,
    data: {
      monthly: monthlyData.rows.map(row => ({
        month: row.month,
        sent: parseInt(row.sent),
        paid: parseInt(row.paid)
      })),
      corridors: corridors.rows.map(row => ({
        corridor: row.corridor,
        count: parseInt(row.count),
        totalAmount: parseFloat(row.total_amount),
        currency: row.currency
      }))
    }
  });
});

// @desc    Get agent performance stats
// @route   GET /api/stats/agents
const getAgentStats = asyncHandler(async (req, res) => {
  const user = req.user;

  // Only admin and supervisor can see all agents
  if (user.role !== 'admin' && user.role !== 'supervisor') {
    return res.status(403).json({
      success: false,
      message: 'Accès non autorisé'
    });
  }

  // Get agent stats
  const agentStats = await query(`
    SELECT 
      u.id,
      u.name,
      u.role,
      u.country,
      u.agent_code,
      COUNT(t.id) FILTER (WHERE t.created_by = u.id) as created_count,
      COUNT(t.id) FILTER (WHERE t.paid_by = u.id) as paid_count,
      COALESCE(SUM(t.amount_sent) FILTER (WHERE t.created_by = u.id), 0) as total_sent,
      COALESCE(SUM(t.amount_received) FILTER (WHERE t.paid_by = u.id), 0) as total_paid
    FROM users u
    LEFT JOIN transfers t ON (t.created_by = u.id OR t.paid_by = u.id) AND t.status != 'cancelled'
    WHERE u.role IN ('sender_agent', 'payer_agent')
    GROUP BY u.id, u.name, u.role, u.country, u.agent_code
    ORDER BY created_count + paid_count DESC
  `);

  res.json({
    success: true,
    data: agentStats.rows.map(row => ({
      id: row.id,
      name: row.name,
      role: row.role,
      country: row.country,
      agentCode: row.agent_code,
      stats: {
        created: parseInt(row.created_count),
        paid: parseInt(row.paid_count),
        totalSent: parseFloat(row.total_sent),
        totalPaid: parseFloat(row.total_paid)
      }
    }))
  });
});

// @desc    Get transaction journal with cumulative totals (like Tmount, Tfees)
// @route   GET /api/stats/journal
const getJournal = asyncHandler(async (req, res) => {
  const { date, country, agentId } = req.query;
  const user = req.user;

  let conditions = [];
  let params = [];
  let paramCount = 0;

  // Tous les agents voient tout le journal (pas de filtre par agent)

  if (date) {
    paramCount++;
    conditions.push(`DATE(t.created_at) = $${paramCount}`);
    params.push(date);
  }

  if (country) {
    paramCount++;
    conditions.push(`(t.sender_country = $${paramCount} OR t.beneficiary_country = $${paramCount})`);
    params.push(country);
  }

  if (agentId) {
    paramCount++;
    conditions.push(`(t.created_by = $${paramCount} OR t.paid_by = $${paramCount})`);
    params.push(agentId);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Get transfers with agent info
  const transfers = await query(`
    SELECT 
      t.id,
      t.reference,
      t.amount_sent,
      t.currency_sent,
      t.exchange_rate,
      t.rate_reel,
      t.fees,
      t.amount_received,
      t.currency_received,
      t.status,
      t.created_at,
      t.sender_country,
      t.beneficiary_country,
      creator.name as creator_name,
      creator.country as creator_country,
      creator.role as creator_role,
      payer.name as payer_name,
      payer.country as payer_country,
      s.first_name || ' ' || s.last_name as sender_name,
      b.first_name || ' ' || b.last_name as beneficiary_name,
      b.phone as beneficiary_phone
    FROM transfers t
    LEFT JOIN users creator ON t.created_by = creator.id
    LEFT JOIN users payer ON t.paid_by = payer.id
    LEFT JOIN senders s ON t.sender_id = s.id
    LEFT JOIN beneficiaries b ON t.beneficiary_id = b.id
    ${whereClause}
    ORDER BY t.created_at ASC
  `, params);

  let cumUsaAmount = 0;
  let cumUsaFees = 0;
  let cumBfAmount = 0;
  let cumBfFees = 0;

  const buildEntry = (row) => {
    const exchangeRate = parseFloat(row.exchange_rate) || 0;
    const rateReel = row.rate_reel ? parseFloat(row.rate_reel) : null;
    const majoration = rateReel !== null ? Math.round((exchangeRate - rateReel) * 100) / 100 : null;

    return {
      id: row.id,
      reference: row.reference,
      sender: { name: row.sender_name, country: row.sender_country },
      beneficiary: { name: row.beneficiary_name, phone: row.beneficiary_phone, country: row.beneficiary_country },
      amountSent: parseFloat(row.amount_sent),
      currencySent: row.currency_sent,
      exchangeRate,
      rateReel,
      majoration,
      fees: parseFloat(row.fees),
      amountReceived: parseFloat(row.amount_received),
      currencyReceived: row.currency_received,
      status: row.status,
      createdAt: row.created_at,
      creator: { name: row.creator_name, country: row.creator_country, role: row.creator_role },
      payer: row.payer_name ? { name: row.payer_name, country: row.payer_country } : null,
    };
  };

  const usaJournal = [];
  const bfJournal = [];

  transfers.rows.forEach((row) => {
    const isUsaToBf = row.sender_country === 'USA' && row.beneficiary_country === 'BFA';
    const isBfToUsa = row.sender_country === 'BFA' && row.beneficiary_country === 'USA';
    const entry = buildEntry(row);

    if (isUsaToBf) {
      cumUsaAmount += parseFloat(row.amount_sent) || 0;
      cumUsaFees += parseFloat(row.fees) || 0;
      usaJournal.push({ ...entry, cumulative: { amount: cumUsaAmount, fees: cumUsaFees } });
    } else if (isBfToUsa) {
      cumBfAmount += parseFloat(row.amount_sent) || 0;
      cumBfFees += parseFloat(row.fees) || 0;
      bfJournal.push({ ...entry, cumulative: { amount: cumBfAmount, fees: cumBfFees } });
    }
  });

  const summaryResult = await query(`
    SELECT 
      COUNT(*) FILTER (WHERE t.sender_country = 'USA' AND t.beneficiary_country = 'BFA') as usa_total,
      COALESCE(SUM(amount_sent) FILTER (WHERE t.sender_country = 'USA' AND t.beneficiary_country = 'BFA'), 0) as usa_amount,
      COALESCE(SUM(fees) FILTER (WHERE t.sender_country = 'USA' AND t.beneficiary_country = 'BFA'), 0) as usa_fees,
      COALESCE(SUM(amount_received) FILTER (WHERE t.sender_country = 'USA' AND t.beneficiary_country = 'BFA'), 0) as usa_received,
      COUNT(*) FILTER (WHERE t.sender_country = 'USA' AND t.beneficiary_country = 'BFA' AND status = 'pending') as usa_pending,
      COUNT(*) FILTER (WHERE t.sender_country = 'USA' AND t.beneficiary_country = 'BFA' AND status = 'paid') as usa_paid,

      COUNT(*) FILTER (WHERE t.sender_country = 'BFA' AND t.beneficiary_country = 'USA') as bf_total,
      COALESCE(SUM(amount_sent) FILTER (WHERE t.sender_country = 'BFA' AND t.beneficiary_country = 'USA'), 0) as bf_amount,
      COALESCE(SUM(fees) FILTER (WHERE t.sender_country = 'BFA' AND t.beneficiary_country = 'USA'), 0) as bf_fees,
      COALESCE(SUM(amount_received) FILTER (WHERE t.sender_country = 'BFA' AND t.beneficiary_country = 'USA'), 0) as bf_received,
      COUNT(*) FILTER (WHERE t.sender_country = 'BFA' AND t.beneficiary_country = 'USA' AND status = 'pending') as bf_pending,
      COUNT(*) FILTER (WHERE t.sender_country = 'BFA' AND t.beneficiary_country = 'USA' AND status = 'paid') as bf_paid
    FROM transfers t
    ${whereClause}
  `, params);

  const s = summaryResult.rows[0];

  res.json({
    success: true,
    data: {
      usa: {
        journal: usaJournal,
        summary: {
          totalTransfers: parseInt(s?.usa_total) || 0,
          totalAmount: parseFloat(s?.usa_amount) || 0,
          totalFees: parseFloat(s?.usa_fees) || 0,
          totalReceived: parseFloat(s?.usa_received) || 0,
          pendingCount: parseInt(s?.usa_pending) || 0,
          paidCount: parseInt(s?.usa_paid) || 0,
          currencyAmount: 'USD',
          currencyFees: 'USD',
          currencyReceived: 'XOF',
        }
      },
      bf: {
        journal: bfJournal,
        summary: {
          totalTransfers: parseInt(s?.bf_total) || 0,
          totalAmount: parseFloat(s?.bf_amount) || 0,
          totalFees: parseFloat(s?.bf_fees) || 0,
          totalReceived: parseFloat(s?.bf_received) || 0,
          pendingCount: parseInt(s?.bf_pending) || 0,
          paidCount: parseInt(s?.bf_paid) || 0,
          currencyAmount: 'XOF',
          currencyFees: 'USD',
          currencyReceived: 'USD',
        }
      }
    }
  });
});

// @desc    Get statistics by country (USA vs BF)
// @route   GET /api/stats/by-country
const getStatsByCountry = asyncHandler(async (req, res) => {
  const { date } = req.query;
  const user = req.user;

  let conditions = [];
  let params = [];
  let paramCount = 0;

  // Tous les agents voient les stats par pays (pas de filtre par agent)

  if (date) {
    paramCount++;
    conditions.push(`DATE(t.created_at) = $${paramCount}`);
    params.push(date);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // USA stats (sender country)
  const usaStats = await query(`
    SELECT 
      COUNT(*) as count,
      COALESCE(SUM(amount_sent), 0) as total_sent,
      COALESCE(SUM(fees), 0) as total_fees,
      COUNT(*) FILTER (WHERE status = 'pending') as pending,
      COUNT(*) FILTER (WHERE status = 'paid') as paid
    FROM transfers t
    ${whereClause} AND t.sender_country = 'USA'
  `, params);

  // BF stats (beneficiary country)
  const bfStats = await query(`
    SELECT 
      COUNT(*) as count,
      COALESCE(SUM(amount_received), 0) as total_received,
      COUNT(*) FILTER (WHERE status = 'pending') as pending,
      COUNT(*) FILTER (WHERE status = 'paid') as paid
    FROM transfers t
    ${whereClause} AND t.beneficiary_country = 'BFA'
  `, params);

  res.json({
    success: true,
    data: {
      usa: {
        transfers: parseInt(usaStats.rows[0]?.count) || 0,
        totalSent: parseFloat(usaStats.rows[0]?.total_sent) || 0,
        totalFees: parseFloat(usaStats.rows[0]?.total_fees) || 0,
        pending: parseInt(usaStats.rows[0]?.pending) || 0,
        paid: parseInt(usaStats.rows[0]?.paid) || 0
      },
      bf: {
        transfers: parseInt(bfStats.rows[0]?.count) || 0,
        totalReceived: parseFloat(bfStats.rows[0]?.total_received) || 0,
        pending: parseInt(bfStats.rows[0]?.pending) || 0,
        paid: parseInt(bfStats.rows[0]?.paid) || 0
      }
    }
  });
});

module.exports = {
  getDashboardStats,
  getTransferStats,
  getAgentStats,
  getJournal,
  getStatsByCountry
};
