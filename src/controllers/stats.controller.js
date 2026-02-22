const { query } = require('../config/database');
const { asyncHandler } = require('../middleware/error.middleware');

// @desc    Get dashboard statistics
// @route   GET /api/stats/dashboard
const getDashboardStats = asyncHandler(async (req, res) => {
  const user = req.user;
  
  // Tous les agents voient toutes les stats (pas de filtre par agent)
  const userCondition = '';
  const params = [];

  // Get transfer counts by status
  const statusCounts = await query(`
    SELECT 
      status,
      COUNT(*) as count,
      SUM(amount_sent) as total_amount
    FROM transfers
    WHERE 1=1 ${userCondition}
    GROUP BY status
  `, params);

  // Get today's transfers
  const todayStats = await query(`
    SELECT 
      COUNT(*) as count,
      COALESCE(SUM(amount_sent), 0) as total_sent,
      COALESCE(SUM(amount_received), 0) as total_received
    FROM transfers
    WHERE DATE(created_at) = CURRENT_DATE ${userCondition}
  `, params);

  // Get this month's transfers
  const monthStats = await query(`
    SELECT 
      COUNT(*) as count,
      COALESCE(SUM(amount_sent), 0) as total_sent,
      COALESCE(SUM(fees), 0) as total_fees
    FROM transfers
    WHERE DATE_TRUNC('month', created_at) = DATE_TRUNC('month', CURRENT_DATE) ${userCondition}
  `, params);

  // Format response based on role
  const statusMap = {};
  statusCounts.rows.forEach(row => {
    statusMap[row.status] = {
      count: parseInt(row.count),
      amount: parseFloat(row.total_amount) || 0
    };
  });

  res.json({
    success: true,
    data: {
      today: {
        transfers: parseInt(todayStats.rows[0]?.count) || 0,
        totalSent: parseFloat(todayStats.rows[0]?.total_sent) || 0,
        totalReceived: parseFloat(todayStats.rows[0]?.total_received) || 0
      },
      month: {
        transfers: parseInt(monthStats.rows[0]?.count) || 0,
        totalSent: parseFloat(monthStats.rows[0]?.total_sent) || 0,
        totalFees: parseFloat(monthStats.rows[0]?.total_fees) || 0
      },
      byStatus: {
        pending: statusMap.pending || { count: 0, amount: 0 },
        inProgress: statusMap.in_progress || { count: 0, amount: 0 },
        paid: statusMap.paid || { count: 0, amount: 0 },
        cancelled: statusMap.cancelled || { count: 0, amount: 0 }
      }
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

  // Date filter (optionnel - si pas de date, afficher tous les transferts)
  if (date) {
    paramCount++;
    conditions.push(`DATE(t.created_at) = $${paramCount}`);
    params.push(date);
  }
  // Sinon, pas de filtre de date = afficher tous les transferts

  // Country filter
  if (country) {
    paramCount++;
    conditions.push(`(t.sender_country = $${paramCount} OR t.beneficiary_country = $${paramCount})`);
    params.push(country);
  }

  // Agent filter
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

  // Cumulative Tmount / Tfees : UNIQUEMENT transferts USA → BF payés (comme sur le dashboard caisse)
  const isUsaToBf = (row) => row.sender_country === 'USA' && row.beneficiary_country === 'BFA';
  let cumulativeAmount = 0;
  let cumulativeFees = 0;

  const journal = transfers.rows.map((row) => {
    if (isUsaToBf(row) && row.status === 'paid') {
      cumulativeAmount += parseFloat(row.amount_sent) || 0;
      cumulativeFees += parseFloat(row.fees) || 0;
    }

    return {
      id: row.id,
      reference: row.reference,
      sender: {
        name: row.sender_name,
        country: row.sender_country
      },
      beneficiary: {
        name: row.beneficiary_name,
        phone: row.beneficiary_phone,
        country: row.beneficiary_country
      },
      amountSent: parseFloat(row.amount_sent),
      currencySent: row.currency_sent,
      fees: parseFloat(row.fees),
      amountReceived: parseFloat(row.amount_received),
      currencyReceived: row.currency_received,
      status: row.status,
      createdAt: row.created_at,
      creator: {
        name: row.creator_name,
        country: row.creator_country,
        role: row.creator_role
      },
      payer: row.payer_name ? {
        name: row.payer_name,
        country: row.payer_country
      } : null,
      cumulative: {
        amount: cumulativeAmount,
        fees: cumulativeFees
      }
    };
  });

  // Get summary totals (Tmount / Tfees = USA → BF payés uniquement)
  const summary = await query(`
    SELECT 
      COUNT(*) as total_transfers,
      COALESCE(SUM(amount_sent), 0) as total_amount,
      COALESCE(SUM(fees), 0) as total_fees,
      COALESCE(SUM(amount_received), 0) as total_received,
      COUNT(*) FILTER (WHERE status = 'pending') as pending_count,
      COUNT(*) FILTER (WHERE status = 'paid') as paid_count,
      COALESCE(SUM(CASE WHEN sender_country = 'USA' AND beneficiary_country = 'BFA' AND status = 'paid' THEN amount_sent END), 0) as tmount_usd,
      COALESCE(SUM(CASE WHEN sender_country = 'USA' AND beneficiary_country = 'BFA' AND status = 'paid' THEN fees END), 0) as tfees_usd
    FROM transfers t
    ${whereClause}
  `, params);

  const s = summary.rows[0];
  res.json({
    success: true,
    data: {
      journal,
      summary: {
        totalTransfers: parseInt(s?.total_transfers) || 0,
        totalAmount: parseFloat(s?.total_amount) || 0,
        totalFees: parseFloat(s?.total_fees) || 0,
        totalReceived: parseFloat(s?.total_received) || 0,
        pendingCount: parseInt(s?.pending_count) || 0,
        paidCount: parseInt(s?.paid_count) || 0,
        tmountUsd: parseFloat(s?.tmount_usd) || 0,
        tfeesUsd: parseFloat(s?.tfees_usd) || 0
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
  const usaWhere = whereClause ? `${whereClause} AND t.sender_country = 'USA'` : "WHERE t.sender_country = 'USA'";
  const bfWhere = whereClause ? `${whereClause} AND t.beneficiary_country = 'BFA'` : "WHERE t.beneficiary_country = 'BFA'";

  // USA stats (sender country)
  const usaStats = await query(`
    SELECT 
      COUNT(*) as count,
      COALESCE(SUM(amount_sent), 0) as total_sent,
      COALESCE(SUM(fees), 0) as total_fees,
      COUNT(*) FILTER (WHERE status = 'pending') as pending,
      COUNT(*) FILTER (WHERE status = 'paid') as paid
    FROM transfers t
    ${usaWhere}
  `, params);

  // BF stats (beneficiary country)
  const bfStats = await query(`
    SELECT 
      COUNT(*) as count,
      COALESCE(SUM(amount_received), 0) as total_received,
      COUNT(*) FILTER (WHERE status = 'pending') as pending,
      COUNT(*) FILTER (WHERE status = 'paid') as paid
    FROM transfers t
    ${bfWhere}
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
