import { db, hasTable } from "./db";
import { digitsOnly, normalizeName } from "./normalize";

export type Provenance = {
  sourceName: string;
  agency: string;
  legalBasis: string | null;
  url: string;
  accessedAt: string;
  sha256: string;
  parserName: string;
  parserVersion: string;
};

const PROVENANCE_JOIN = `
  JOIN parse pa ON pa.id = t.provenance_id
  JOIN collection col ON col.id = pa.collection_id
  JOIN source src ON src.id = col.source_id
`;

const PROVENANCE_COLUMNS = `
  src.name        AS srcSourceName,
  src.agency      AS srcAgency,
  src.legal_basis AS srcLegalBasis,
  col.url         AS srcUrl,
  col.accessed_at AS srcAccessedAt,
  col.payload_sha256 AS srcSha256,
  pa.parser_name  AS srcParserName,
  pa.parser_version AS srcParserVersion
`;

function pickProvenance(row: Record<string, unknown>): Provenance {
  return {
    sourceName: row.srcSourceName as string,
    agency: row.srcAgency as string,
    legalBasis: (row.srcLegalBasis as string) ?? null,
    url: row.srcUrl as string,
    accessedAt: row.srcAccessedAt as string,
    sha256: row.srcSha256 as string,
    parserName: row.srcParserName as string,
    parserVersion: row.srcParserVersion as string,
  };
}

// ---------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------

export type SearchResult = {
  personId: number;
  canonicalName: string;
  cpf: string | null;
  cpfTrusted: boolean;
  candidacyCount: number;
  latestYear: number;
  latestOffice: string | null;
  latestPartyAbbr: string | null;
  latestState: string | null;
  latestResult: string | null;
};

export function searchPeople(rawQuery: string, limit = 25): SearchResult[] {
  const query = rawQuery.trim();
  if (query.length < 2) return [];

  const digits = digitsOnly(query);
  const looksLikeCpf = digits.length >= 6 && digits.length <= 11;

  // IMPORTANT: filter + LIMIT to a handful of people FIRST (`matches`), then
  // look up each match's latest candidacy with a per-row indexed lookup.
  // The previous version computed ROW_NUMBER() OVER the entire 1.6M-row
  // politician_history table before the name filter even applied — every
  // keystroke did a full-table window function. This keeps the expensive
  // part (per-person "latest candidacy" lookup) scoped to `limit` rows.
  const sql = `
    WITH matches AS (
      SELECT id, canonical_name, cpf, cpf_trusted
      FROM people
      WHERE ${looksLikeCpf ? "cpf LIKE ?" : "canonical_name LIKE ?"}
      LIMIT ?
    )
    SELECT
      m.id AS personId, m.canonical_name AS canonicalName, m.cpf AS cpf,
      m.cpf_trusted AS cpfTrusted,
      (SELECT count(*) FROM politician_history WHERE person_id = m.id) AS candidacyCount,
      l.year AS latestYear, l.office AS latestOffice,
      l.party_abbr AS latestPartyAbbr, l.state AS latestState, l.result AS latestResult
    FROM matches m
    LEFT JOIN politician_history l ON l.id = (
      SELECT id FROM politician_history
      WHERE person_id = m.id
      ORDER BY year DESC, round DESC
      LIMIT 1
    )
    ORDER BY l.year DESC
  `;
  const pattern = looksLikeCpf ? `${digits}%` : `%${normalizeName(query)}%`;
  // Over-fetch candidates before the name filter narrows further (LIMIT
  // applies inside `matches`, before we know which rows even have a
  // candidacy), then trim to `limit` after sorting by recency.
  const rows = (db().prepare(sql).all(pattern, limit * 4) as Array<Record<string, unknown>>)
    .slice(0, limit);
  return rows.map((r) => ({
    personId: r.personId as number,
    canonicalName: r.canonicalName as string,
    cpf: (r.cpf as string) ?? null,
    cpfTrusted: !!r.cpfTrusted,
    candidacyCount: r.candidacyCount as number,
    latestYear: r.latestYear as number,
    latestOffice: (r.latestOffice as string) ?? null,
    latestPartyAbbr: (r.latestPartyAbbr as string) ?? null,
    latestState: (r.latestState as string) ?? null,
    latestResult: (r.latestResult as string) ?? null,
  }));
}

// ---------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------

export type Person = {
  id: number;
  cpf: string | null;
  cpfTrusted: boolean;
  voterId: string | null;
  canonicalName: string | null;
};

export type Candidacy = {
  id: number;
  year: number;
  electionType: string | null;
  round: number | null;
  office: string | null;
  candidateNumber: string | null;
  partyAbbr: string | null;
  partyName: string | null;
  state: string | null;
  electoralUnit: string | null;
  municipality: string | null;
  candidacyStatus: string | null;
  candidacyStatusDetail: string | null;
  result: string | null;
  ballotName: string | null;
  fullName: string | null;
  birthDate: string | null;
  gender: string | null;
  education: string | null;
  maritalStatus: string | null;
  race: string | null;
  occupation: string | null;
  tseCandidacyId: string | null;
  provenance: Provenance;
};

export type CampaignOrg = {
  id: number;
  cnpj: string;
  year: number;
  office: string | null;
  partyAbbr: string | null;
  state: string | null;
  provenance: Provenance;
};

export type SocialMediaLink = {
  id: number;
  year: number;
  platform: string;
  url: string;
  state: string | null;
  provenance: Provenance;
};

export type FinanceSummary = {
  donationsCount: number;
  donationsTotalCents: number;
  expensesCount: number;
  expensesTotalCents: number;
  paymentsTotalCents: number;
};

export type Signal = {
  id: number;
  type: string;
  severity: "low" | "medium" | "high";
  explanation: string;
  role: string;
  rule: string;
  ruleVersion: string;
  expense: {
    id: number;
    description: string | null;
    amountCents: number;
    year: number;
    supplierName: string | null;
  } | null;
  // Present for circular_donations signals -- every cpf/cnpj in the cycle,
  // in order, for a "ver no grafo" link (/grafo?add=...).
  graphIds: string[] | null;
  aiReview: AiReviewBrief | null;
};

export type PersonProfile = {
  person: Person;
  candidacies: Candidacy[];
  campaignOrgs: CampaignOrg[];
  socialMedia: SocialMediaLink[];
  finance: FinanceSummary;
  signals: Signal[];
  signalsCount: number;
};

export function getPersonProfile(personId: number): PersonProfile | null {
  const person = db()
    .prepare(
      `SELECT id, cpf, cpf_trusted AS cpfTrusted, voter_id AS voterId, canonical_name AS canonicalName
       FROM people WHERE id = ?`
    )
    .get(personId) as
    | { id: number; cpf: string | null; cpfTrusted: number; voterId: string | null; canonicalName: string | null }
    | undefined;
  if (!person) return null;

  const candidacyRows = db()
    .prepare(
      `SELECT t.id, t.year, t.election_type AS electionType, t.round,
              t.office, t.candidate_number AS candidateNumber,
              t.party_abbr AS partyAbbr, t.party_name AS partyName, t.state,
              t.electoral_unit AS electoralUnit, t.municipality,
              t.candidacy_status AS candidacyStatus,
              t.candidacy_status_detail AS candidacyStatusDetail,
              t.result, t.ballot_name AS ballotName, t.full_name AS fullName,
              t.birth_date AS birthDate, t.gender, t.education,
              t.marital_status AS maritalStatus, t.race, t.occupation,
              t.tse_candidacy_id AS tseCandidacyId,
              ${PROVENANCE_COLUMNS}
       FROM politician_history t
       ${PROVENANCE_JOIN}
       WHERE t.person_id = ?
       ORDER BY t.year DESC, t.round DESC`
    )
    .all(personId) as Array<Record<string, unknown>>;

  const campaignOrgRows = db()
    .prepare(
      `SELECT t.id, t.cnpj, t.year, t.office, t.party_abbr AS partyAbbr, t.state,
              ${PROVENANCE_COLUMNS}
       FROM campaign_org t
       ${PROVENANCE_JOIN}
       WHERE t.person_id = ?
       ORDER BY t.year DESC`
    )
    .all(personId) as Array<Record<string, unknown>>;

  const socialMediaRows = db()
    .prepare(
      `SELECT t.id, t.year, t.platform, t.url, t.state,
              ${PROVENANCE_COLUMNS}
       FROM social_media t
       ${PROVENANCE_JOIN}
       WHERE t.person_id = ?
       ORDER BY t.year DESC, t.platform`
    )
    .all(personId) as Array<Record<string, unknown>>;

  // Money the person's campaign(s) received / paid — joined through campaign_org,
  // since campaign_donation/campaign_expense carry the RECIPIENT's org, not a
  // direct person_id (donor_person_id / supplier_person_id is the OTHER side).
  const donationsAgg = db()
    .prepare(
      `SELECT count(*) AS n, coalesce(sum(t.amount_cents), 0) AS total
       FROM campaign_donation t JOIN campaign_org co ON co.id = t.campaign_org_id
       WHERE co.person_id = ?`
    )
    .get(personId) as { n: number; total: number };

  const expensesAgg = db()
    .prepare(
      `SELECT count(*) AS n, coalesce(sum(t.amount_cents), 0) AS total
       FROM campaign_expense t JOIN campaign_org co ON co.id = t.campaign_org_id
       WHERE co.person_id = ?`
    )
    .get(personId) as { n: number; total: number };

  const paymentsAgg = db()
    .prepare(
      `SELECT coalesce(sum(p.amount_cents), 0) AS total
       FROM campaign_expense_payment p
       JOIN campaign_expense ce ON ce.id = p.campaign_expense_id
       JOIN campaign_org co ON co.id = ce.campaign_org_id
       WHERE co.person_id = ?`
    )
    .get(personId) as { total: number };

  // Full donation/expense lists are served paginated + searchable by
  // /api/finance -> getFinancePage (see <FinanceTable>), not baked in here.

  // Signals (see ADs/dados_derivados.md) never come from a source — they're
  // produced by our own rule code over data already in the DB. A person can
  // be named as either the candidate whose campaign spent the money or the
  // supplier who got paid; role tells them apart. One row per signal --
  // deliberately NOT joined to signal_evidence here: a circular_donations
  // signal can have many evidence rows, which would multiply this signal
  // into duplicate rows. Per-type detail (expense line, cycle actors) is
  // fetched separately below, keyed by signal id.
  const signalRows = db()
    .prepare(
      `SELECT s.id, s.type, s.severity, s.explanation, sa.role,
              rr.rule, rr.rule_version AS ruleVersion,
              s.amount_cents AS amountCents,
              ar.verdict AS aiVerdict, ar.confidence AS aiConfidence,
              ar.explanation AS aiExplanation, ar.model AS aiModel
       FROM signal_actor sa
       JOIN signal s ON s.id = sa.signal_id
       JOIN rule_run rr ON rr.id = s.rule_run_id
       LEFT JOIN signal_ai_review ar ON ar.signal_id = s.id
         AND ar.reviewed_at = (SELECT max(x.reviewed_at) FROM signal_ai_review x WHERE x.signal_id = s.id)
       WHERE sa.type = 'person' AND sa.actor_id = ?
       ORDER BY CASE s.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
                coalesce(s.amount_cents, 0) DESC
       LIMIT 30`
    )
    .all(personId) as Array<Record<string, unknown>>;

  const expenseSignalIds = signalRows.filter((r) => r.rule === "disproportionate_expense").map((r) => r.id as number);
  const expenseBySignal = new Map<number, Record<string, unknown>>();
  if (expenseSignalIds.length > 0) {
    const ph = expenseSignalIds.map(() => "?").join(", ");
    for (const row of db()
      .prepare(
        `SELECT se.signal_id AS signalId, ce.id, ce.description, ce.amount_cents AS amountCents,
                ce.year, ce.supplier_name AS supplierName
         FROM signal_evidence se JOIN campaign_expense ce ON ce.id = se.record_id
         WHERE se.signal_id IN (${ph}) AND se.table_name = 'campaign_expense'`
      )
      .all(...expenseSignalIds) as Array<Record<string, unknown>>) {
      expenseBySignal.set(row.signalId as number, row);
    }
  }

  const cycleSignalIds = signalRows.filter((r) => r.rule === "circular_donations").map((r) => r.id as number);
  const graphIdsBySignal = new Map<number, string[]>();
  if (cycleSignalIds.length > 0) {
    const ph = cycleSignalIds.map(() => "?").join(", ");
    for (const row of db()
      .prepare(
        `SELECT sa.signal_id AS signalId,
                CASE WHEN sa.type = 'person' THEN p.cpf ELSE c.cnpj END AS cpfCnpj
         FROM signal_actor sa
         LEFT JOIN people p ON sa.type = 'person' AND p.id = sa.actor_id
         LEFT JOIN companies c ON sa.type = 'company' AND c.id = sa.actor_id
         WHERE sa.signal_id IN (${ph})`
      )
      .all(...cycleSignalIds) as Array<{ signalId: number; cpfCnpj: string | null }>) {
      if (!row.cpfCnpj) continue;
      const list = graphIdsBySignal.get(row.signalId) ?? [];
      list.push(row.cpfCnpj);
      graphIdsBySignal.set(row.signalId, list);
    }
  }

  const signalsCount = (
    db()
      .prepare(
        "SELECT count(DISTINCT signal_id) AS n FROM signal_actor WHERE type = 'person' AND actor_id = ?"
      )
      .get(personId) as { n: number }
  ).n;

  return {
    person: {
      id: person.id,
      cpf: person.cpf,
      cpfTrusted: !!person.cpfTrusted,
      voterId: person.voterId,
      canonicalName: person.canonicalName,
    },
    candidacies: candidacyRows.map((r) => ({
      id: r.id as number,
      year: r.year as number,
      electionType: (r.electionType as string) ?? null,
      round: (r.round as number) ?? null,
      office: (r.office as string) ?? null,
      candidateNumber: (r.candidateNumber as string) ?? null,
      partyAbbr: (r.partyAbbr as string) ?? null,
      partyName: (r.partyName as string) ?? null,
      state: (r.state as string) ?? null,
      electoralUnit: (r.electoralUnit as string) ?? null,
      municipality: (r.municipality as string) ?? null,
      candidacyStatus: (r.candidacyStatus as string) ?? null,
      candidacyStatusDetail: (r.candidacyStatusDetail as string) ?? null,
      result: (r.result as string) ?? null,
      ballotName: (r.ballotName as string) ?? null,
      fullName: (r.fullName as string) ?? null,
      birthDate: (r.birthDate as string) ?? null,
      gender: (r.gender as string) ?? null,
      education: (r.education as string) ?? null,
      maritalStatus: (r.maritalStatus as string) ?? null,
      race: (r.race as string) ?? null,
      occupation: (r.occupation as string) ?? null,
      tseCandidacyId: (r.tseCandidacyId as string) ?? null,
      provenance: pickProvenance(r),
    })),
    campaignOrgs: campaignOrgRows.map((r) => ({
      id: r.id as number,
      cnpj: r.cnpj as string,
      year: r.year as number,
      office: (r.office as string) ?? null,
      partyAbbr: (r.partyAbbr as string) ?? null,
      state: (r.state as string) ?? null,
      provenance: pickProvenance(r),
    })),
    socialMedia: socialMediaRows.map((r) => ({
      id: r.id as number,
      year: r.year as number,
      platform: r.platform as string,
      url: r.url as string,
      state: (r.state as string) ?? null,
      provenance: pickProvenance(r),
    })),
    finance: {
      donationsCount: donationsAgg.n,
      donationsTotalCents: donationsAgg.total,
      expensesCount: expensesAgg.n,
      expensesTotalCents: expensesAgg.total,
      paymentsTotalCents: paymentsAgg.total,
    },
    signals: signalRows.map((r) => {
      const id = r.id as number;
      const expenseRow = expenseBySignal.get(id);
      return {
        id,
        type: r.type as string,
        severity: r.severity as Signal["severity"],
        explanation: r.explanation as string,
        role: r.role as string,
        rule: r.rule as string,
        ruleVersion: r.ruleVersion as string,
        expense: expenseRow ? {
          id: expenseRow.id as number,
          description: (expenseRow.description as string) ?? null,
          amountCents: (expenseRow.amountCents as number) ?? 0,
          year: expenseRow.year as number,
          supplierName: (expenseRow.supplierName as string) ?? null,
        } : null,
        graphIds: graphIdsBySignal.get(id) ?? null,
        aiReview: r.aiVerdict
          ? {
              verdict: r.aiVerdict as AiVerdict,
              confidence: (r.aiConfidence as string) ?? null,
              explanation: (r.aiExplanation as string) ?? "",
              model: (r.aiModel as string) ?? "",
            }
          : null,
      };
    }),
    signalsCount,
  };
}

// ---------------------------------------------------------------------
// Home: top suppliers ("empresas que mais lucraram com campanhas")
// ---------------------------------------------------------------------

export type TopSupplier = {
  cnpj: string;
  name: string;
  totalCents: number;
  paymentCount: number;
  candidacyCount: number;
};

let cachedExpenseYears: number[] | null = null;

export function getExpenseYears(): number[] {
  // Same rewrite-only reasoning as lib/stats.ts: safe to compute once per
  // server process instead of scanning campaign_expense on every home visit.
  if (cachedExpenseYears) return cachedExpenseYears;
  const rows = db()
    .prepare("SELECT DISTINCT year FROM campaign_expense ORDER BY year DESC")
    .all() as Array<{ year: number }>;
  cachedExpenseYears = rows.map((r) => r.year);
  return cachedExpenseYears;
}

export function getTopSuppliers(year: number | null, limit = 10): TopSupplier[] {
  const sql = `
    SELECT
      supplier_cpf_cnpj AS cnpj,
      max(coalesce(supplier_name_rfb, supplier_name)) AS name,
      sum(amount_cents) AS totalCents,
      count(*) AS paymentCount,
      count(DISTINCT tse_candidacy_id) AS candidacyCount
    FROM campaign_expense
    WHERE supplier_company_id IS NOT NULL
      ${year != null ? "AND year = ?" : ""}
    GROUP BY supplier_cpf_cnpj
    ORDER BY totalCents DESC
    LIMIT ?
  `;
  const params = year != null ? [year, limit] : [limit];
  const rows = db().prepare(sql).all(...params) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    cnpj: r.cnpj as string,
    name: (r.name as string) ?? "(nome não disponível)",
    totalCents: r.totalCents as number,
    paymentCount: r.paymentCount as number,
    candidacyCount: r.candidacyCount as number,
  }));
}

// ---------------------------------------------------------------------
// Entity profile (/cnpj/[cnpj], /cpf/[cpf]) — for a given CPF/CNPJ, not
// scoped to any one campaign: everywhere it appears as a DONOR (money it
// gave, to any campaign) and everywhere it appears as a SUPPLIER (money it
// received, from any campaign), plus federal sanctions if any.
// ---------------------------------------------------------------------

export type EntitySanction = {
  id: number;
  registry: string;
  category: string | null;
  fineAmountCents: number | null;
  startDate: string | null;
  endDate: string | null;
  sanctioningAgency: string | null;
  agencySphere: string | null;
  provenance: Provenance;
};

export type CompanyRegistry = {
  legalName: string | null;
  tradeName: string | null;
  openedAt: string | null;
  registryStatus: string | null;
  legalNature: string | null;
  primaryCnae: string | null;
  shareCapitalCents: number | null;
  size: string | null;
  city: string | null;
  state: string | null;
  provenance: Provenance;
};

export type CompanyPartner = {
  id: number;
  partnerName: string;
  role: string | null;
  entryDate: string | null;
};

export type EntityProfile = {
  cpfCnpj: string;
  isCompany: boolean;
  displayName: string | null;
  personId: number | null;   // set when this CPF is already a known politician
  companyKind: string | null; // companies.kind, when this CNPJ is tracked
  registry: CompanyRegistry | null; // Receita Federal data, when we've fetched it (companies only)
  partners: CompanyPartner[];
  donationsGivenTotal: { count: number; totalCents: number };
  paymentsReceivedTotal: { count: number; totalCents: number };
  sanctions: EntitySanction[];
};

/** If this CPF/CNPJ is a candidate (or their campaign CNPJ), the person's
 * id -- so /cpf and /cnpj pages can redirect to the full /politico/[id]
 * profile ("juntar os 3"). Null for a plain donor/supplier/company. */
export function candidatePersonId(cpfCnpj: string): number | null {
  const digits = digitsOnly(cpfCnpj);
  if (digits.length !== 11 && digits.length !== 14) return null;
  const row =
    digits.length === 11
      ? (db().prepare("SELECT id FROM people WHERE cpf = ?").get(digits) as { id: number } | undefined)
      : (db()
          .prepare(
            `SELECT p.id FROM campaign_org co JOIN companies c ON c.id = co.company_id
             JOIN people p ON p.id = co.person_id WHERE c.cnpj = ? LIMIT 1`
          )
          .get(digits) as { id: number } | undefined);
  return row?.id ?? null;
}

export function getEntityProfile(cpfCnpj: string): EntityProfile | null {
  const digits = digitsOnly(cpfCnpj);
  if (digits.length !== 11 && digits.length !== 14) return null;
  const isCompany = digits.length === 14;

  let personId: number | null = null;
  let companyKind: string | null = null;
  let displayName: string | null = null;
  let registry: CompanyRegistry | null = null;
  let partners: CompanyPartner[] = [];

  if (isCompany) {
    const company = db()
      .prepare("SELECT kind, legal_name FROM companies WHERE cnpj = ?")
      .get(digits) as { kind: string | null; legal_name: string | null } | undefined;
    if (company) {
      companyKind = company.kind;
      displayName = company.legal_name;
    }

    const registryRow = db()
      .prepare(
        `SELECT t.legal_name AS legalName, t.trade_name AS tradeName, t.opened_at AS openedAt,
                t.registry_status AS registryStatus, t.legal_nature AS legalNature,
                t.primary_cnae AS primaryCnae, t.share_capital_cents AS shareCapitalCents,
                t.size, t.city, t.state,
                ${PROVENANCE_COLUMNS}
         FROM company_registry t
         ${PROVENANCE_JOIN}
         WHERE t.cnpj = ?`
      )
      .get(digits) as Record<string, unknown> | undefined;
    if (registryRow) {
      displayName = (registryRow.legalName as string) ?? displayName;
      registry = {
        legalName: (registryRow.legalName as string) ?? null,
        tradeName: (registryRow.tradeName as string) ?? null,
        openedAt: (registryRow.openedAt as string) ?? null,
        registryStatus: (registryRow.registryStatus as string) ?? null,
        legalNature: (registryRow.legalNature as string) ?? null,
        primaryCnae: (registryRow.primaryCnae as string) ?? null,
        shareCapitalCents: (registryRow.shareCapitalCents as number) ?? null,
        size: (registryRow.size as string) ?? null,
        city: (registryRow.city as string) ?? null,
        state: (registryRow.state as string) ?? null,
        provenance: pickProvenance(registryRow),
      };
    }

    partners = (
      db()
        .prepare(
          `SELECT id, partner_name AS partnerName, role, entry_date AS entryDate
           FROM company_partner WHERE cnpj = ? ORDER BY entry_date DESC`
        )
        .all(digits) as Array<{ id: number; partnerName: string; role: string | null; entryDate: string | null }>
    ).map((p) => ({ id: p.id, partnerName: p.partnerName, role: p.role, entryDate: p.entryDate }));
  } else {
    const person = db()
      .prepare("SELECT id, canonical_name FROM people WHERE cpf = ?")
      .get(digits) as { id: number; canonical_name: string | null } | undefined;
    if (person) {
      personId = person.id;
      displayName = person.canonical_name;
    }
  }

  const donationsAgg = db()
    .prepare(
      `SELECT count(*) AS n, coalesce(sum(amount_cents), 0) AS total
       FROM campaign_donation WHERE donor_cpf_cnpj = ?`
    )
    .get(digits) as { n: number; total: number };

  const paymentsAgg = db()
    .prepare(
      `SELECT count(*) AS n, coalesce(sum(amount_cents), 0) AS total
       FROM campaign_expense WHERE supplier_cpf_cnpj = ?`
    )
    .get(digits) as { n: number; total: number };

  // No hits anywhere in the system -> a dead-end page, not worth rendering.
  if (
    donationsAgg.n === 0 && paymentsAgg.n === 0 &&
    personId === null && companyKind === null && registry === null
  ) {
    const hasSanction = db()
      .prepare("SELECT 1 FROM sanction WHERE cpf_cnpj = ? LIMIT 1")
      .get(digits);
    if (!hasSanction) return null;
  }

  // The donation/payment lists themselves are served paginated + searchable
  // by /api/finance -> getFinancePage (see <FinanceTable>); here we only
  // need the totals for the header.

  const sanctionRows = db()
    .prepare(
      `SELECT t.id, t.registry, t.category, t.fine_amount_cents AS fineAmountCents,
              t.start_date AS startDate, t.end_date AS endDate,
              t.sanctioning_agency AS sanctioningAgency, t.agency_sphere AS agencySphere,
              ${PROVENANCE_COLUMNS}
       FROM sanction t
       ${PROVENANCE_JOIN}
       WHERE t.cpf_cnpj = ?
       ORDER BY t.start_date DESC`
    )
    .all(digits) as Array<Record<string, unknown>>;

  return {
    cpfCnpj: digits,
    isCompany,
    displayName,
    personId,
    companyKind,
    registry,
    partners,
    donationsGivenTotal: { count: donationsAgg.n, totalCents: donationsAgg.total },
    paymentsReceivedTotal: { count: paymentsAgg.n, totalCents: paymentsAgg.total },
    sanctions: sanctionRows.map((r) => ({
      id: r.id as number,
      registry: r.registry as string,
      category: (r.category as string) ?? null,
      fineAmountCents: (r.fineAmountCents as number) ?? null,
      startDate: (r.startDate as string) ?? null,
      endDate: (r.endDate as string) ?? null,
      sanctioningAgency: (r.sanctioningAgency as string) ?? null,
      agencySphere: (r.agencySphere as string) ?? null,
      provenance: pickProvenance(r),
    })),
  };
}

// ---------------------------------------------------------------------
// Campaign finance -- paginated + searchable list of a candidate's
// donations/expenses, or of an entity's donations given / payments
// received. Backs the <FinanceTable> on the profile pages.
// ---------------------------------------------------------------------

export type FinanceRow = {
  id: number;
  year: number;
  date: string | null;
  amountCents: number;
  paidCents: number | null; // expenses only
  counterpartyName: string | null;
  counterpartyDoc: string | null;
  counterpartyPersonId: number | null;
  counterpartyOpenedAt: string | null; // company opening date (Receita), when the counterparty is an enriched CNPJ
  detail: string | null;
};

export type FinancePage = { rows: FinanceRow[]; total: number; pageSize: number };

export const FINANCE_PAGE_SIZE = 25;

export type FinanceSort = "amount" | "paid" | "year" | "date" | "name";

export type FinanceQuery = {
  scope: "candidate" | "entity";
  id: string; // personId (candidate scope) or cpf/cnpj (entity scope)
  dir: "received" | "spent" | "given";
  page?: number;
  q?: string;
  sort?: FinanceSort;
  order?: "asc" | "desc";
};

// sort key -> the SELECT alias to ORDER BY (all safe literals)
const FINANCE_SORT_COL: Record<FinanceSort, string> = {
  amount: "amountCents",
  paid: "paidCents",
  year: "yr",
  date: "date",
  name: "counterpartyName",
};

export function getFinancePage(params: FinanceQuery): FinancePage {
  const page = Math.max(1, Math.floor(params.page ?? 1));
  const offset = (page - 1) * FINANCE_PAGE_SIZE;
  const q = params.q?.trim() ?? "";
  const sortCol = FINANCE_SORT_COL[params.sort ?? "amount"] ?? "amountCents";
  const sortDir = params.order === "asc" ? "ASC" : "DESC";

  let where: string;
  let select: string;
  let from: string;
  const args: unknown[] = [];

  if (params.scope === "candidate" && params.dir === "received") {
    from = `campaign_donation t JOIN campaign_org co ON co.id = t.campaign_org_id
            LEFT JOIN company_registry cr ON cr.cnpj = t.donor_cpf_cnpj`;
    select = `t.id, t.year AS yr, t.receipt_date AS date, t.amount_cents AS amountCents, NULL AS paidCents,
              t.donor_name AS counterpartyName, t.donor_cpf_cnpj AS counterpartyDoc,
              NULL AS counterpartyPersonId, cr.opened_at AS counterpartyOpenedAt, t.origin AS detail`;
    where = "co.person_id = ?";
    args.push(Number(params.id));
    // SQLite LIKE is ASCII case-insensitive by default; donor_name is raw TSE
    // text (not accent-stripped), so an accented query won't match a
    // non-accented spelling and vice-versa -- a known limitation.
    if (q) { where += " AND t.donor_name LIKE ?"; args.push(`%${q}%`); }
  } else if (params.scope === "candidate" && params.dir === "spent") {
    from = `campaign_expense t JOIN campaign_org co ON co.id = t.campaign_org_id
            LEFT JOIN company_registry cr ON cr.cnpj = t.supplier_cpf_cnpj`;
    select = `t.id, t.year AS yr, t.expense_date AS date, t.amount_cents AS amountCents,
              (SELECT coalesce(sum(x.amount_cents), 0) FROM campaign_expense_payment x
               WHERE x.campaign_expense_id = t.id) AS paidCents,
              t.supplier_name AS counterpartyName, t.supplier_cpf_cnpj AS counterpartyDoc,
              NULL AS counterpartyPersonId, cr.opened_at AS counterpartyOpenedAt, t.description AS detail`;
    where = "co.person_id = ?";
    args.push(Number(params.id));
    if (q) {
      where += " AND (t.supplier_name LIKE ? OR t.description LIKE ?)";
      args.push(`%${q}%`, `%${q}%`);
    }
  } else {
    // entity scope: given = donations this cpf/cnpj made; received = payments it got
    const isGiven = params.dir === "given";
    from = `${isGiven ? "campaign_donation" : "campaign_expense"} t
            JOIN campaign_org co ON co.id = t.campaign_org_id
            LEFT JOIN people p ON p.id = co.person_id`;
    select = `t.id, t.year AS yr, ${isGiven ? "t.receipt_date" : "t.expense_date"} AS date,
              t.amount_cents AS amountCents,
              ${isGiven ? "NULL" : `(SELECT coalesce(sum(x.amount_cents), 0) FROM campaign_expense_payment x WHERE x.campaign_expense_id = t.id)`} AS paidCents,
              p.canonical_name AS counterpartyName, t.cnpj AS counterpartyDoc,
              co.person_id AS counterpartyPersonId, NULL AS counterpartyOpenedAt, t.origin AS detail`;
    where = isGiven ? "t.donor_cpf_cnpj = ?" : "t.supplier_cpf_cnpj = ?";
    args.push(digitsOnly(params.id));
    if (q) { where += " AND p.canonical_name LIKE ?"; args.push(`%${normalizeName(q)}%`); }
  }

  // `from`/`select`/`where` are built from fixed literals above; every
  // user-supplied value is a bound `?` parameter.
  const total = (
    db().prepare(`SELECT count(*) AS n FROM ${from} WHERE ${where}`).get(...args) as { n: number }
  ).n;
  const rows = db()
    .prepare(
      `SELECT ${select} FROM ${from} WHERE ${where}
       ORDER BY (${sortCol} IS NULL), ${sortCol} ${sortDir}, t.id ${sortDir}
       LIMIT ? OFFSET ?`
    )
    .all(...args, FINANCE_PAGE_SIZE, offset) as Array<Record<string, unknown>>;

  return {
    total,
    pageSize: FINANCE_PAGE_SIZE,
    rows: rows.map((r) => ({
      id: r.id as number,
      year: r.yr as number,
      date: (r.date as string) ?? null,
      amountCents: (r.amountCents as number) ?? 0,
      paidCents: r.paidCents == null ? null : (r.paidCents as number),
      counterpartyName: (r.counterpartyName as string) ?? null,
      counterpartyDoc: (r.counterpartyDoc as string) ?? null,
      counterpartyPersonId: (r.counterpartyPersonId as number) ?? null,
      counterpartyOpenedAt: (r.counterpartyOpenedAt as string) ?? null,
      detail: (r.detail as string) ?? null,
    })),
  };
}

// ---------------------------------------------------------------------
// Graph (/grafo) — search entities to add as nodes, then find direct
// correlations (money flows) among whatever set of nodes is on the canvas.
// ---------------------------------------------------------------------

export type GraphSearchResult = {
  type: "person" | "company";
  cpfCnpj: string;
  label: string;
  sublabel: string | null;
};

export function searchEntities(rawQuery: string, limit = 15): GraphSearchResult[] {
  const query = rawQuery.trim();
  if (query.length < 2) return [];
  const digits = digitsOnly(query);

  // A pasted CPF/CNPJ resolves directly, even if we don't have a name for it
  // (e.g. an un-enriched company) -- that's still a valid node to add.
  if (digits.length === 11 || digits.length === 14) {
    // A campaign CNPJ IS its candidate ("juntar os 3") -- resolve to the CPF.
    const ident = getGraphIdentity([digits]).get(digits);
    if (ident && ident.canonical !== digits) {
      return [{ type: "person", cpfCnpj: ident.canonical, label: ident.name ?? ident.canonical, sublabel: "político" }];
    }
    const isCompany = digits.length === 14;
    if (isCompany) {
      const row = db()
        .prepare(
          `SELECT c.cnpj, coalesce(cr.legal_name, c.legal_name) AS name, c.kind
           FROM companies c LEFT JOIN company_registry cr ON cr.company_id = c.id
           WHERE c.cnpj = ?`
        )
        .get(digits) as { cnpj: string; name: string | null; kind: string | null } | undefined;
      if (row) {
        return [{ type: "company", cpfCnpj: row.cnpj, label: row.name ?? formatCnpjLocal(row.cnpj),
                   sublabel: row.kind }];
      }
      return [{ type: "company", cpfCnpj: digits, label: formatCnpjLocal(digits), sublabel: null }];
    }
    const row = db()
      .prepare("SELECT cpf, canonical_name FROM people WHERE cpf = ?")
      .get(digits) as { cpf: string; canonical_name: string | null } | undefined;
    if (row) {
      return [{ type: "person", cpfCnpj: row.cpf, label: row.canonical_name ?? digits, sublabel: null }];
    }
    return [{ type: "person", cpfCnpj: digits, label: digits, sublabel: null }];
  }

  const pattern = `%${normalizeName(query)}%`;
  const people = db()
    .prepare(
      `SELECT cpf, canonical_name FROM people
       WHERE canonical_name LIKE ? AND cpf IS NOT NULL LIMIT ?`
    )
    .all(pattern, limit) as Array<{ cpf: string; canonical_name: string | null }>;
  const companies = db()
    .prepare(
      `SELECT c.cnpj, coalesce(cr.legal_name, c.legal_name) AS name
       FROM companies c LEFT JOIN company_registry cr ON cr.company_id = c.id
       WHERE coalesce(cr.legal_name, c.legal_name) LIKE ? LIMIT ?`
    )
    .all(pattern, limit) as Array<{ cnpj: string; name: string | null }>;

  return [
    ...people.map((p): GraphSearchResult => ({
      type: "person", cpfCnpj: p.cpf, label: p.canonical_name ?? p.cpf, sublabel: "político",
    })),
    ...companies.map((c): GraphSearchResult => ({
      type: "company", cpfCnpj: c.cnpj, label: c.name ?? c.cnpj, sublabel: "empresa",
    })),
  ].slice(0, limit);
}

function formatCnpjLocal(cnpj: string): string {
  return cnpj.length === 14
    ? `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`
    : cnpj;
}

export type GraphNodeKind = "politician" | "donor" | "supplier" | "sanctioned" | "company" | "person";

export type GraphNodeInfo = {
  cpfCnpj: string;
  type: "person" | "company";
  kind: GraphNodeKind; // drives node color
  label: string;
  sanctioned: boolean;
  registryStatus: string | null; // companies only
};

export type GraphEdgeKind = "donation" | "payment";

export type GraphEdge = {
  source: string; // cpfCnpj (the donor, or the politician who paid)
  target: string; // cpfCnpj (the politician who received, or the supplier paid)
  kind: GraphEdgeKind;
  amountCents: number;
  count: number;
};

/** People are looked up by cpf, companies by cnpj -- everything else the same shape.
 * `edges` (optional) are the donation/payment edges being drawn on this same
 * pass -- used to color a plain-citizen CPF (someone who never ran for
 * office, so has no `people` row at all -- see ADs/identidade.md, we never
 * fabricate one) as donor/supplier from context, the same way a company
 * without a stored kind would fall back to "empresa" neutral. */
function lookupNodes(
  rawIds: string[],
  edges: Array<{ source: string; target: string; kind: GraphEdgeKind }> = []
): Map<string, GraphNodeInfo> {
  // Defensive filter: a null/empty id should never reach here (callers already
  // exclude NULL donor/supplier/cpf columns at the SQL level), but this is
  // what stands between a bad row and a crash if one ever slips through.
  const clean = rawIds.filter((id): id is string => typeof id === "string" && id.length > 0);
  const placeholders = clean.map(() => "?").join(", ");
  const nodeById = new Map<string, GraphNodeInfo>();
  if (clean.length === 0) return nodeById;

  // A CPF only ever gets a `people` row if it belongs to someone who actually
  // ran for office (see ADs/identidade.md -- plain donors/suppliers never get
  // one fabricated). So "found in `people`" IS the candidacy check: that's
  // the only correct signal for the amber "político" color, not just "is an
  // 11-digit id" (which every donor/supplier CPF also is).
  const people = db()
    .prepare(`SELECT cpf, canonical_name FROM people WHERE cpf IN (${placeholders})`)
    .all(...clean) as Array<{ cpf: string; canonical_name: string | null }>;
  const companies = db()
    .prepare(
      `SELECT c.cnpj, c.kind, coalesce(cr.legal_name, c.legal_name) AS name,
              cr.registry_status AS registryStatus
       FROM companies c LEFT JOIN company_registry cr ON cr.company_id = c.id
       WHERE c.cnpj IN (${placeholders})`
    )
    .all(...clean) as Array<{ cnpj: string; kind: string | null; name: string | null; registryStatus: string | null }>;
  const sanctioned = new Set(
    (
      db()
        .prepare(`SELECT DISTINCT cpf_cnpj FROM sanction WHERE cpf_cnpj IN (${placeholders})`)
        .all(...clean) as Array<{ cpf_cnpj: string }>
    ).map((r) => r.cpf_cnpj)
  );
  // A CNPJ that IS a candidacy's campaign committee is that candidate --
  // same amber bolinha as their CPF ("juntar os 3"). Graph ids are
  // normally canonicalised to the CPF upstream (getGraphPaths /
  // resolveGraphNode), so this is a fallback for a committee CNPJ that
  // reaches here raw; authoritative via campaign_org, not companies.kind.
  const committeeOwner = new Map<string, string | null>();
  for (const r of db()
    .prepare(
      `SELECT DISTINCT c.cnpj, p.canonical_name AS name FROM campaign_org co
       JOIN companies c ON c.id = co.company_id JOIN people p ON p.id = co.person_id
       WHERE c.cnpj IN (${placeholders})`
    )
    .all(...clean) as Array<{ cnpj: string; name: string | null }>) {
    if (!committeeOwner.has(r.cnpj)) committeeOwner.set(r.cnpj, r.name);
  }

  for (const id of clean) {
    nodeById.set(id, {
      cpfCnpj: id, type: id.length === 14 ? "company" : "person",
      // Neutral default -- upgraded to "politician" below only for CPFs that
      // actually turn up in `people` (i.e. really ran for office), and to
      // donor/supplier from edge context otherwise. Nobody defaults to amber.
      kind: id.length === 14 ? "company" : "person",
      label: id.length === 14 ? formatCnpjLocal(id) : id,
      sanctioned: sanctioned.has(id), registryStatus: null,
    });
  }
  for (const p of people) {
    const n = nodeById.get(p.cpf);
    if (n) {
      n.label = p.canonical_name ?? p.cpf;
      n.kind = "politician";
    }
  }
  for (const c of companies) {
    const n = nodeById.get(c.cnpj);
    if (n) {
      n.label = c.name ?? formatCnpjLocal(c.cnpj);
      n.registryStatus = c.registryStatus;
      if (c.kind === "donor" || c.kind === "supplier") n.kind = c.kind;
    }
  }
  // Plain citizens (no `people` row -- never ran for office) get colored by
  // their role in the edges being drawn right now: gave money = donor,
  // received money = supplier. A citizen with no edge either way (rare --
  // e.g. typed in directly via search) stays the neutral "person" gray.
  for (const e of edges) {
    if (e.kind === "donation") {
      const n = nodeById.get(e.source);
      if (n && n.type === "person" && n.kind === "person") n.kind = "donor";
    } else if (e.kind === "payment") {
      const n = nodeById.get(e.target);
      if (n && n.type === "person" && n.kind === "person") n.kind = "supplier";
    }
  }
  // A campaign committee CNPJ is the candidate: amber, named.
  for (const [cnpj, name] of committeeOwner) {
    const n = nodeById.get(cnpj);
    if (n) {
      n.kind = "politician";
      if (name) n.label = name;
    }
  }
  // sanctioned overrides the color regardless of donor/supplier/company/person
  for (const n of nodeById.values()) {
    if (n.sanctioned) n.kind = "sanctioned";
  }
  return nodeById;
}

// One row = one money edge touching `anchor`. Bidirectional: an anchor
// shows up whether it's the source or the target (anchorIsSource tells
// which). Self-financing (donor == candidate, candidate == own supplier) is
// filtered out -- it's not a link to anyone.
type IncidentRow = {
  anchor: string;
  other: string;
  kind: GraphEdgeKind;
  amountCents: number;
  n: number;
  anchorIsSource: 0 | 1;
};

function incidentEdges(anchorIds: string[]): IncidentRow[] {
  if (anchorIds.length === 0) return [];
  const ph = anchorIds.map(() => "?").join(", ");
  const sql = `
    SELECT d.donor_cpf_cnpj AS anchor, p.cpf AS other, 'donation' AS kind,
           sum(d.amount_cents) AS amountCents, count(*) AS n, 1 AS anchorIsSource
    FROM campaign_donation d JOIN campaign_org co ON co.id = d.campaign_org_id
    JOIN people p ON p.id = co.person_id
    WHERE d.donor_cpf_cnpj IN (${ph}) AND p.cpf IS NOT NULL AND d.donor_cpf_cnpj != p.cpf
    GROUP BY d.donor_cpf_cnpj, p.cpf
    UNION ALL
    SELECT p.cpf AS anchor, d.donor_cpf_cnpj AS other, 'donation',
           sum(d.amount_cents), count(*), 0
    FROM campaign_donation d JOIN campaign_org co ON co.id = d.campaign_org_id
    JOIN people p ON p.id = co.person_id
    WHERE p.cpf IN (${ph}) AND d.donor_cpf_cnpj IS NOT NULL AND d.donor_cpf_cnpj != p.cpf
    GROUP BY p.cpf, d.donor_cpf_cnpj
    UNION ALL
    SELECT p.cpf AS anchor, e.supplier_cpf_cnpj AS other, 'payment',
           sum(e.amount_cents), count(*), 1
    FROM campaign_expense e JOIN campaign_org co ON co.id = e.campaign_org_id
    JOIN people p ON p.id = co.person_id
    WHERE p.cpf IN (${ph}) AND e.supplier_cpf_cnpj IS NOT NULL AND p.cpf != e.supplier_cpf_cnpj
    GROUP BY p.cpf, e.supplier_cpf_cnpj
    UNION ALL
    SELECT e.supplier_cpf_cnpj AS anchor, p.cpf AS other, 'payment',
           sum(e.amount_cents), count(*), 0
    FROM campaign_expense e JOIN campaign_org co ON co.id = e.campaign_org_id
    JOIN people p ON p.id = co.person_id
    WHERE e.supplier_cpf_cnpj IN (${ph}) AND p.cpf IS NOT NULL AND p.cpf != e.supplier_cpf_cnpj
    GROUP BY e.supplier_cpf_cnpj, p.cpf
  `;
  const params: string[] = [];
  for (let i = 0; i < 4; i++) params.push(...anchorIds);
  return db().prepare(sql).all(...params) as IncidentRow[];
}

type GraphIdentity = { canonical: string; name: string | null; aliases: string[] };

/** A candidate = one CPF + their campaign CNPJ(s). Given any mix of cpfs and
 * cnpjs, returns per input id: the canonical id (the candidate's CPF, if it
 * resolves to one -- whether the input was the CPF or a campaign CNPJ; the
 * id itself otherwise), the candidate's name when known, and every alias
 * (CPF + all their campaign CNPJs). "juntar os 3": a graph lookup for a
 * politician has to catch money that moved through their committee CNPJ too. */
function getGraphIdentity(ids: string[]): Map<string, GraphIdentity> {
  const out = new Map<string, GraphIdentity>();
  const clean = [...new Set(ids.map(digitsOnly).filter((d) => d.length === 11 || d.length === 14))];
  if (clean.length === 0) return out;
  const ph = clean.map(() => "?").join(", ");

  const cnpjOwner = new Map<string, string>();
  for (const r of db()
    .prepare(
      `SELECT DISTINCT c.cnpj, p.cpf FROM campaign_org co
       JOIN companies c ON c.id = co.company_id JOIN people p ON p.id = co.person_id
       WHERE c.cnpj IN (${ph}) AND p.cpf IS NOT NULL`
    )
    .all(...clean) as Array<{ cnpj: string; cpf: string }>) {
    if (!cnpjOwner.has(r.cnpj)) cnpjOwner.set(r.cnpj, r.cpf);
  }

  const cpfs = [...new Set([...clean.filter((d) => d.length === 11), ...cnpjOwner.values()])];
  const byCpf = new Map<string, { name: string | null; cnpjs: Set<string> }>();
  if (cpfs.length > 0) {
    const cph = cpfs.map(() => "?").join(", ");
    for (const r of db()
      .prepare(
        `SELECT p.cpf, p.canonical_name AS name, c.cnpj
         FROM people p
         LEFT JOIN campaign_org co ON co.person_id = p.id
         LEFT JOIN companies c ON c.id = co.company_id
         WHERE p.cpf IN (${cph})`
      )
      .all(...cpfs) as Array<{ cpf: string; name: string | null; cnpj: string | null }>) {
      const rec = byCpf.get(r.cpf) ?? { name: r.name, cnpjs: new Set<string>() };
      if (r.cnpj) rec.cnpjs.add(r.cnpj);
      byCpf.set(r.cpf, rec);
    }
  }

  for (const id of clean) {
    if (id.length === 11 && byCpf.has(id)) {
      const rec = byCpf.get(id)!;
      out.set(id, { canonical: id, name: rec.name, aliases: [id, ...rec.cnpjs] });
    } else if (id.length === 14 && cnpjOwner.has(id)) {
      const cpf = cnpjOwner.get(id)!;
      const rec = byCpf.get(cpf);
      out.set(id, { canonical: cpf, name: rec?.name ?? null, aliases: [cpf, ...(rec?.cnpjs ?? [])] });
    } else {
      out.set(id, { canonical: id, name: null, aliases: [id] });
    }
  }
  return out;
}

function incidentToEdge(r: IncidentRow): GraphEdge {
  const [source, target] = r.anchorIsSource ? [r.anchor, r.other] : [r.other, r.anchor];
  return { source, target, kind: r.kind, amountCents: r.amountCents, count: r.n };
}

/** When a node is added to the canvas: every link of distance <= 2 between
 * it and the entities ALREADY there. Distance 1 is a direct donation/payment
 * edge; distance 2 is an intermediary M (a shared donor, a shared supplier,
 * a candidate who funded one and was paid by the other, ...) that isn't on
 * the canvas yet -- M comes back as a new node plus the two edges of the
 * path. Only actual connectors are returned, never the new node's whole
 * neighbourhood, so the payload stays small even for a politician with
 * hundreds of counterparties; the frontend still caps how many connectors
 * it materialises (see graph-canvas.tsx).
 *
 * A CPF and its campaign CNPJ(s) are ONE candidate here ("juntar os 3"):
 * both the input ids and every edge endpoint are canonicalised to the CPF,
 * and edges that collapse to a self-loop (a politician "donating to their
 * own committee") are dropped. */
export function getGraphPaths(
  newIdRaw: string, existingIdsRaw: string[]
): { nodes: GraphNodeInfo[]; edges: GraphEdge[] } {
  const newDigits = digitsOnly(newIdRaw);
  if (newDigits.length !== 11 && newDigits.length !== 14) return { nodes: [], edges: [] };
  const existingDigits = [
    ...new Set(existingIdsRaw.map(digitsOnly).filter((d) => d.length === 11 || d.length === 14)),
  ];

  const idents = getGraphIdentity([newDigits, ...existingDigits]);
  const canon = (raw: string) => idents.get(raw)?.canonical ?? raw;
  const newId = canon(newDigits);
  const existing = [...new Set(existingDigits.map(canon).filter((d) => d !== newId))];
  const onCanvas = new Set([newId, ...existing]);

  const canonToAliases = new Map<string, string[]>();
  for (const it of idents.values()) canonToAliases.set(it.canonical, it.aliases);
  const aliasToCanon = new Map<string, string>();
  for (const [c, aliases] of canonToAliases) for (const a of aliases) aliasToCanon.set(a, c);
  const anchorAliases = [...new Set([newId, ...existing].flatMap((c) => canonToAliases.get(c) ?? [c]))];

  const rawRows = incidentEdges(anchorAliases);
  // Canonicalise both ends of every edge, then drop self-loops (own
  // committee, self-financing) and re-key by canonical.
  const otherIdents = getGraphIdentity([...new Set(rawRows.map((r) => r.other))]);
  const rows: IncidentRow[] = rawRows
    .map((r) => ({
      ...r,
      anchor: aliasToCanon.get(r.anchor) ?? r.anchor,
      other: otherIdents.get(r.other)?.canonical ?? r.other,
    }))
    .filter((r) => r.anchor !== r.other);

  // other -> every edge between it and newId / an existing node. Arrays, not
  // one row: A->B donation AND B->A payment between the same pair is exactly
  // what makes a 2-node cycle, so both must survive.
  const fromNew = new Map<string, IncidentRow[]>();
  const fromExisting = new Map<string, IncidentRow[]>();
  for (const r of rows) {
    const bucket = r.anchor === newId ? fromNew : fromExisting;
    const list = bucket.get(r.other) ?? [];
    list.push(r);
    bucket.set(r.other, list);
  }

  const edges: GraphEdge[] = [];
  const connectorIds = new Set<string>();

  for (const e of existing) {
    for (const r of fromNew.get(e) ?? []) edges.push(incidentToEdge(r));
  }
  for (const [m, nEdges] of fromNew) {
    if (onCanvas.has(m)) continue;
    const eEdges = fromExisting.get(m);
    if (!eEdges || eEdges.length === 0) continue;
    connectorIds.add(m);
    for (const r of nEdges) edges.push(incidentToEdge(r));
    for (const r of eEdges) edges.push(incidentToEdge(r));
  }

  const allIds = [newId, ...existing, ...connectorIds];
  const nodeById = lookupNodes(allIds, edges);

  const seen = new Set<string>();
  const deduped = edges.filter((e) => {
    const k = `${e.source}|${e.target}|${e.kind}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { nodes: [...nodeById.values()], edges: deduped };
}

/** Just ONE node's own info -- no neighbors, no donors/suppliers pulled in.
 * This is deliberately the ONLY thing adding a node to /grafo does now: a
 * politician with a huge donor/supplier network (Lula: 600+ direct
 * counterparties) used to bring the whole thing in on a single click, which
 * could make the browser tab hang. The graph is now built entirely by
 * getGraphPaths() finding distance-<=2 links BETWEEN whatever entities were
 * deliberately added -- see web/src/components/graph-canvas.tsx. A campaign
 * CNPJ resolves to its candidate's CPF ("juntar os 3"). */
export function resolveGraphNode(cpfCnpj: string): GraphNodeInfo | null {
  const digits = digitsOnly(cpfCnpj);
  if (digits.length !== 11 && digits.length !== 14) return null;
  const ident = getGraphIdentity([digits]).get(digits);
  const canonical = ident?.canonical ?? digits;
  const node = lookupNodes([canonical]).get(canonical) ?? null;
  if (node && ident?.name) {
    node.label = ident.name;
    node.kind = "politician";
  }
  return node;
}

// ------------------------------------------------------------------
// circular_donations signals (elosys/rules/circular_donations.py) --
// browsable list, mirroring the graph page's own "add a real thing, see the
// evidence" spirit. Same signal/signal_actor/signal_evidence tables every
// rule uses (see ADs/dados_derivados.md) -- nothing rule-specific in the
// schema, just a rule-specific label ('circular_donations') and actor role
// ('cycle_member').
// ------------------------------------------------------------------

export type CircularDonationActor = {
  cpfCnpj: string;
  label: string;
  type: "person" | "company";
};

export type AiVerdict = "bizarro" | "plausivel" | "inconclusivo";

export type AiReviewBrief = {
  verdict: AiVerdict;
  confidence: string | null;
  explanation: string;
  model: string;
};

export type CircularDonationSignal = {
  id: number;
  severity: "high" | "medium" | "low";
  explanation: string;
  amountCents: number;
  pathLength: number;
  actors: CircularDonationActor[];
  aiReview: AiReviewBrief | null;
};

export type CircularDonationSort = "severity" | "amount" | "path_length";

export type CircularDonationSummary = {
  total: number;
  bySeverity: Record<string, number>;
  ruleVersion: string | null;
  maxDepth: number | null;
  runAt: string | null;
};

const CIRCULAR_RULE = "circular_donations";

export function getCircularDonationSummary(): CircularDonationSummary {
  const bySeverity = Object.fromEntries(
    (
      db()
        .prepare(
          `SELECT s.severity, count(*) AS n FROM signal s
           JOIN rule_run rr ON rr.id = s.rule_run_id
           WHERE rr.rule = ? GROUP BY s.severity`
        )
        .all(CIRCULAR_RULE) as Array<{ severity: string; n: number }>
    ).map((r) => [r.severity, r.n])
  );
  const total = Object.values(bySeverity).reduce((a, b) => a + b, 0);
  const lastRun = db()
    .prepare(
      `SELECT rule_version AS ruleVersion, params, run_at AS runAt
       FROM rule_run WHERE rule = ? ORDER BY id DESC LIMIT 1`
    )
    .get(CIRCULAR_RULE) as { ruleVersion: string; params: string | null; runAt: string } | undefined;
  let maxDepth: number | null = null;
  if (lastRun?.params) {
    try {
      maxDepth = (JSON.parse(lastRun.params) as { max_depth?: number }).max_depth ?? null;
    } catch {
      maxDepth = null;
    }
  }
  return {
    total, bySeverity,
    ruleVersion: lastRun?.ruleVersion ?? null,
    maxDepth,
    runAt: lastRun?.runAt ?? null,
  };
}

const SORT_CLAUSE: Record<CircularDonationSort, string> = {
  severity: "CASE s.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, s.id",
  amount: "coalesce(s.amount_cents, 0) DESC, s.id",
  path_length: "coalesce(s.path_length, 0) ASC, coalesce(s.amount_cents, 0) DESC, s.id",
};

export function getCircularDonationSignals(opts: {
  severity?: "high" | "medium" | "low";
  sort?: CircularDonationSort;
  limit?: number;
  offset?: number;
}): CircularDonationSignal[] {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const orderBy = SORT_CLAUSE[opts.sort ?? "severity"] ?? SORT_CLAUSE.severity;
  const rows = db()
    .prepare(
      `SELECT s.id, s.severity, s.explanation,
              coalesce(s.amount_cents, 0) AS amountCents, coalesce(s.path_length, 0) AS pathLength,
              ar.verdict AS aiVerdict, ar.confidence AS aiConfidence,
              ar.explanation AS aiExplanation, ar.model AS aiModel
       FROM signal s JOIN rule_run rr ON rr.id = s.rule_run_id
       LEFT JOIN signal_ai_review ar ON ar.signal_id = s.id
         AND ar.reviewed_at = (SELECT max(x.reviewed_at) FROM signal_ai_review x WHERE x.signal_id = s.id)
       WHERE rr.rule = ? AND (? IS NULL OR s.severity = ?)
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`
    )
    .all(CIRCULAR_RULE, opts.severity ?? null, opts.severity ?? null, limit, offset) as Array<{
      id: number; severity: string; explanation: string; amountCents: number; pathLength: number;
      aiVerdict: string | null; aiConfidence: string | null; aiExplanation: string | null; aiModel: string | null;
    }>;
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => "?").join(", ");
  const actorRows = db()
    .prepare(
      `SELECT sa.signal_id AS signalId, sa.type,
              CASE WHEN sa.type = 'person' THEN p.cpf ELSE c.cnpj END AS cpfCnpj,
              CASE WHEN sa.type = 'person' THEN p.canonical_name
                   ELSE coalesce(cr.legal_name, c.legal_name) END AS label
       FROM signal_actor sa
       LEFT JOIN people p ON sa.type = 'person' AND p.id = sa.actor_id
       LEFT JOIN companies c ON sa.type = 'company' AND c.id = sa.actor_id
       LEFT JOIN company_registry cr ON cr.company_id = c.id
       WHERE sa.signal_id IN (${placeholders})`
    )
    .all(...ids) as Array<{ signalId: number; type: "person" | "company"; cpfCnpj: string | null; label: string | null }>;

  const actorsBySignal = new Map<number, CircularDonationActor[]>();
  for (const a of actorRows) {
    if (!a.cpfCnpj) continue;
    const list = actorsBySignal.get(a.signalId) ?? [];
    list.push({ cpfCnpj: a.cpfCnpj, label: a.label ?? a.cpfCnpj, type: a.type });
    actorsBySignal.set(a.signalId, list);
  }

  return rows.map((r): CircularDonationSignal => ({
    id: r.id,
    severity: r.severity as CircularDonationSignal["severity"],
    explanation: r.explanation,
    amountCents: r.amountCents,
    pathLength: r.pathLength,
    actors: actorsBySignal.get(r.id) ?? [],
    aiReview: r.aiVerdict
      ? {
          verdict: r.aiVerdict as AiVerdict,
          confidence: r.aiConfidence,
          explanation: r.aiExplanation ?? "",
          model: r.aiModel ?? "",
        }
      : null,
  }));
}

// ------------------------------------------------------------------
// AI review (elosys/rules/ai_review.py -> signal_ai_review) -- an LLM's
// "rotineiro vs. bizarro" second opinion, browsable on /sinais/analise-ia.
// ------------------------------------------------------------------

export type AiReviewRow = {
  signalId: number;
  rule: string;
  ruleLabel: string;
  signalExplanation: string;
  signalAmountCents: number;
  verdict: AiVerdict;
  confidence: string | null;
  explanation: string;
  facts: string[];
  model: string;
  reviewedAt: string;
  graphIds: string[] | null; // circular_donations only, for a /grafo?add= link
};

const RULE_LABEL: Record<string, string> = {
  circular_donations: "doação circular",
  disproportionate_expense: "despesa desproporcional",
};

export function getAiReviewSummary(): { total: number; byVerdict: Record<string, number>; model: string | null } {
  const byVerdict = Object.fromEntries(
    (
      db()
        .prepare(`SELECT verdict, count(*) AS n FROM signal_ai_review GROUP BY verdict`)
        .all() as Array<{ verdict: string; n: number }>
    ).map((r) => [r.verdict, r.n])
  );
  const total = Object.values(byVerdict).reduce((a, b) => a + b, 0);
  const model = (
    db().prepare(`SELECT model FROM signal_ai_review ORDER BY reviewed_at DESC LIMIT 1`).get() as
      | { model: string }
      | undefined
  )?.model ?? null;
  return { total, byVerdict, model };
}

const VERDICT_ORDER = "CASE ar.verdict WHEN 'bizarro' THEN 0 WHEN 'inconclusivo' THEN 1 ELSE 2 END";

export function getAiReviewCount(opts: { verdict?: AiVerdict; rule?: string }): number {
  return (
    db()
      .prepare(
        `SELECT count(*) AS n FROM signal_ai_review ar
         JOIN signal s ON s.id = ar.signal_id
         JOIN rule_run rr ON rr.id = s.rule_run_id
         WHERE (? IS NULL OR ar.verdict = ?) AND (? IS NULL OR rr.rule = ?)`
      )
      .get(opts.verdict ?? null, opts.verdict ?? null, opts.rule ?? null, opts.rule ?? null) as { n: number }
  ).n;
}

export function getAiReviews(opts: {
  verdict?: AiVerdict;
  rule?: string;
  limit?: number;
  offset?: number;
}): AiReviewRow[] {
  const limit = opts.limit ?? 30;
  const offset = opts.offset ?? 0;
  const rows = db()
    .prepare(
      `SELECT ar.signal_id AS signalId, rr.rule, s.explanation AS signalExplanation,
              coalesce(s.amount_cents, (
                SELECT ce.amount_cents FROM signal_evidence se
                JOIN campaign_expense ce ON ce.id = se.record_id
                WHERE se.signal_id = s.id AND se.table_name = 'campaign_expense' LIMIT 1
              ), 0) AS signalAmountCents,
              ar.verdict, ar.confidence, ar.explanation, ar.facts, ar.model, ar.reviewed_at AS reviewedAt
       FROM signal_ai_review ar
       JOIN signal s ON s.id = ar.signal_id
       JOIN rule_run rr ON rr.id = s.rule_run_id
       WHERE (? IS NULL OR ar.verdict = ?) AND (? IS NULL OR rr.rule = ?)
         AND ar.reviewed_at = (SELECT max(x.reviewed_at) FROM signal_ai_review x WHERE x.signal_id = ar.signal_id)
       ORDER BY ${VERDICT_ORDER}, signalAmountCents DESC
       LIMIT ? OFFSET ?`
    )
    .all(opts.verdict ?? null, opts.verdict ?? null, opts.rule ?? null, opts.rule ?? null, limit, offset) as Array<{
      signalId: number; rule: string; signalExplanation: string; signalAmountCents: number;
      verdict: string; confidence: string | null; explanation: string; facts: string | null;
      model: string; reviewedAt: string;
    }>;
  if (rows.length === 0) return [];

  // graph ids for the circular ones
  const cycleIds = rows.filter((r) => r.rule === "circular_donations").map((r) => r.signalId);
  const graphIdsBySignal = new Map<number, string[]>();
  if (cycleIds.length > 0) {
    const ph = cycleIds.map(() => "?").join(", ");
    for (const row of db()
      .prepare(
        `SELECT sa.signal_id AS signalId,
                CASE WHEN sa.type = 'person' THEN p.cpf ELSE c.cnpj END AS cpfCnpj
         FROM signal_actor sa
         LEFT JOIN people p ON sa.type = 'person' AND p.id = sa.actor_id
         LEFT JOIN companies c ON sa.type = 'company' AND c.id = sa.actor_id
         WHERE sa.signal_id IN (${ph})`
      )
      .all(...cycleIds) as Array<{ signalId: number; cpfCnpj: string | null }>) {
      if (!row.cpfCnpj) continue;
      const list = graphIdsBySignal.get(row.signalId) ?? [];
      list.push(row.cpfCnpj);
      graphIdsBySignal.set(row.signalId, list);
    }
  }

  return rows.map((r): AiReviewRow => {
    let facts: string[] = [];
    try {
      const parsed = JSON.parse(r.facts ?? "[]");
      if (Array.isArray(parsed)) facts = parsed.map((f) => String(f));
    } catch {
      facts = [];
    }
    return {
      signalId: r.signalId,
      rule: r.rule,
      ruleLabel: RULE_LABEL[r.rule] ?? r.rule,
      signalExplanation: r.signalExplanation,
      signalAmountCents: r.signalAmountCents,
      verdict: r.verdict as AiVerdict,
      confidence: r.confidence,
      explanation: r.explanation,
      facts,
      model: r.model,
      reviewedAt: r.reviewedAt,
      graphIds: graphIdsBySignal.get(r.signalId) ?? null,
    };
  });
}

// ------------------------------------------------------------------
// Political donation network (politician -> politician only), depth 2, for
// the profile page. Deliberately narrower than /grafo: only edges where BOTH
// ends are known candidates (donor_person_id IS NOT NULL -- see
// ADs/politician.md, that column is only ever set when the donor's CPF
// already matches someone in `people`), no companies, no plain-citizen
// donors. "Doou pra" fans out to the right, "recebeu de" to the left, same
// convention as /grafo.
// ------------------------------------------------------------------

export type PoliticianNetworkNode = {
  personId: number;
  label: string;
  amountCents: number; // this edge's amount (to/from the node one level closer to center)
};

export type PoliticianNetworkBranch = {
  node: PoliticianNetworkNode;
  children: PoliticianNetworkNode[]; // depth 2: this node's own donors/recipients
};

export type PoliticianDonationNetwork = {
  donatedTo: PoliticianNetworkBranch[]; // right side, depth 1 + 2
  receivedFrom: PoliticianNetworkBranch[]; // left side, depth 1 + 2
};

const MAX_PER_LEVEL = 6;

/** Candidates `personId` donated to (right side) or received from (left
 * side), aggregated by recipient/donor, largest amount first, capped. */
function politicianDonationEdges(
  personId: number, direction: "donated_to" | "received_from"
): PoliticianNetworkNode[] {
  const sql = direction === "donated_to"
    ? `SELECT co.person_id AS personId, coalesce(p2.canonical_name, '(sem nome)') AS label,
              sum(d.amount_cents) AS amountCents
       FROM campaign_donation d
       JOIN campaign_org co ON co.id = d.campaign_org_id
       JOIN people p2 ON p2.id = co.person_id
       WHERE d.donor_person_id = ? AND co.person_id != ?
       GROUP BY co.person_id ORDER BY amountCents DESC LIMIT ?`
    : `SELECT d.donor_person_id AS personId, coalesce(p2.canonical_name, '(sem nome)') AS label,
              sum(d.amount_cents) AS amountCents
       FROM campaign_donation d
       JOIN campaign_org co ON co.id = d.campaign_org_id
       JOIN people p2 ON p2.id = d.donor_person_id
       WHERE co.person_id = ? AND d.donor_person_id IS NOT NULL AND d.donor_person_id != ?
       GROUP BY d.donor_person_id ORDER BY amountCents DESC LIMIT ?`;
  return db().prepare(sql).all(personId, personId, MAX_PER_LEVEL) as PoliticianNetworkNode[];
}

export function getPoliticianDonationNetwork(personId: number): PoliticianDonationNetwork {
  const build = (direction: "donated_to" | "received_from"): PoliticianNetworkBranch[] =>
    politicianDonationEdges(personId, direction).map((node) => ({
      node,
      children: politicianDonationEdges(node.personId, direction).filter((c) => c.personId !== personId),
    }));

  return {
    donatedTo: build("donated_to"),
    receivedFrom: build("received_from"),
  };
}

// ------------------------------------------------------------------
// candidate_supplier_partner -- a candidate who appears in the quadro
// societário of a company that received campaign money. The name+6-digit
// match is NOT deterministic (see the schema.sql comment) -- every row is a
// "possível", flagged as such in the UI (/sinais/socio-fornecedor).
// ------------------------------------------------------------------

export type SupplierPartnerRow = {
  personId: number;
  personName: string | null;
  companyCnpj: string;
  companyName: string | null;
  partnerRole: string | null;
  partnerSince: string | null;
  paymentsTotalCents: number;
  paymentsCount: number;
  payerCandidacies: number;
  paidBySelf: boolean;
};

export type SupplierPartnerFilter = "all" | "self" | "others";

export function getSupplierPartnerSummary(): {
  total: number;
  self: number;
  others: number;
  totalCents: number;
} {
  if (!hasTable("candidate_supplier_partner")) return { total: 0, self: 0, others: 0, totalCents: 0 };
  const row = db()
    .prepare(
      `SELECT count(*) AS total,
              coalesce(sum(paid_by_self), 0) AS self,
              coalesce(sum(payments_total_cents), 0) AS totalCents
       FROM candidate_supplier_partner`
    )
    .get() as { total: number; self: number; totalCents: number };
  return { total: row.total, self: row.self, others: row.total - row.self, totalCents: row.totalCents };
}

export function getSupplierPartnerCount(opts: { filter?: SupplierPartnerFilter; q?: string }): number {
  if (!hasTable("candidate_supplier_partner")) return 0;
  const { where, args } = supplierPartnerWhere(opts);
  return (
    db()
      .prepare(
        `SELECT count(*) AS n
         FROM candidate_supplier_partner csp
         JOIN people p ON p.id = csp.person_id
         JOIN companies c ON c.id = csp.company_id
         ${where}`
      )
      .get(...args) as { n: number }
  ).n;
}

function supplierPartnerWhere(opts: { filter?: SupplierPartnerFilter; q?: string }): {
  where: string;
  args: unknown[];
} {
  const clauses: string[] = [];
  const args: unknown[] = [];
  if (opts.filter === "self") clauses.push("csp.paid_by_self = 1");
  if (opts.filter === "others") clauses.push("csp.paid_by_self = 0");
  const q = opts.q?.trim();
  if (q) {
    clauses.push("(p.canonical_name LIKE ? OR coalesce(cr.legal_name, c.legal_name) LIKE ?)");
    args.push(`%${normalizeName(q)}%`, `%${q}%`);
  }
  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", args };
}

export function getSupplierPartners(opts: {
  filter?: SupplierPartnerFilter;
  q?: string;
  limit?: number;
  offset?: number;
}): SupplierPartnerRow[] {
  if (!hasTable("candidate_supplier_partner")) return [];
  const limit = opts.limit ?? 40;
  const offset = opts.offset ?? 0;
  const { where, args } = supplierPartnerWhere(opts);
  const rows = db()
    .prepare(
      `SELECT csp.person_id AS personId, p.canonical_name AS personName,
              c.cnpj AS companyCnpj, coalesce(cr.legal_name, c.legal_name) AS companyName,
              csp.partner_role AS partnerRole, csp.partner_since AS partnerSince,
              csp.payments_total_cents AS paymentsTotalCents, csp.payments_count AS paymentsCount,
              csp.payer_candidacies AS payerCandidacies, csp.paid_by_self AS paidBySelf
       FROM candidate_supplier_partner csp
       JOIN people p ON p.id = csp.person_id
       JOIN companies c ON c.id = csp.company_id
       LEFT JOIN company_registry cr ON cr.company_id = c.id
       ${where}
       ORDER BY csp.payments_total_cents DESC
       LIMIT ? OFFSET ?`
    )
    .all(...args, limit, offset) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    personId: r.personId as number,
    personName: (r.personName as string) ?? null,
    companyCnpj: r.companyCnpj as string,
    companyName: (r.companyName as string) ?? null,
    partnerRole: (r.partnerRole as string) ?? null,
    partnerSince: (r.partnerSince as string) ?? null,
    paymentsTotalCents: (r.paymentsTotalCents as number) ?? 0,
    paymentsCount: (r.paymentsCount as number) ?? 0,
    payerCandidacies: (r.payerCandidacies as number) ?? 0,
    paidBySelf: !!r.paidBySelf,
  }));
}

// ------------------------------------------------------------------
// DISCURSO EM REDE SOCIAL -- posts do X (contas declaradas ao TSE)
// sinalizados por elosys/rules/social_review.py. Conteúdo efêmero
// (ver schema.sql): a linha carrega o texto arquivado + o link pro
// tweet vivo. NADA é conclusão -- "classificação automática, pode
// errar", o trecho literal está sempre à vista. /sinais/discurso
// ------------------------------------------------------------------

export const DISCOURSE_GROUP_CATEGORIES = [
  "lgbtfobia", "racismo", "misoginia", "capacitismo", "xenofobia", "regionalismo",
  "aporofobia", "gordofobia", "antissemitismo", "intolerancia_religiosa", "etarismo_saude",
] as const;
export const DISCOURSE_OTHER_CATEGORIES = ["desumanizacao", "xingamento_pessoal"] as const;
export type DiscourseCategory =
  | (typeof DISCOURSE_GROUP_CATEGORIES)[number]
  | (typeof DISCOURSE_OTHER_CATEGORIES)[number];
export type DiscourseSeverity = "high" | "medium" | "low";

export type DiscourseSignal = {
  postId: number;
  handle: string;
  personId: number | null;
  personName: string | null;
  party: string | null;
  state: string | null;
  kind: string;
  text: string;
  url: string | null;
  postedAt: string | null;
  matchedTerms: string[];
  severity: DiscourseSeverity | null;
  categories: string[];
  quote: string | null;
  explanation: string | null;
  replyToHandle: string | null;
};

function discourseWhere(opts: {
  category?: string;
  severity?: string;
  group?: boolean;
  handle?: string;
  q?: string;
}): { where: string; args: unknown[] } {
  const clauses = ["r.is_offensive = 1"];
  const args: unknown[] = [];
  if (opts.category) {
    clauses.push("r.categories LIKE ?");
    args.push(`%"${opts.category}"%`);
  } else if (opts.group) {
    clauses.push(`(${DISCOURSE_GROUP_CATEGORIES.map(() => "r.categories LIKE ?").join(" OR ")})`);
    args.push(...DISCOURSE_GROUP_CATEGORIES.map((c) => `%"${c}"%`));
  }
  if (opts.severity && ["high", "medium", "low"].includes(opts.severity)) {
    clauses.push("r.severity = ?");
    args.push(opts.severity);
  }
  const h = opts.handle?.trim().replace(/^@/, "").toLowerCase();
  if (h) {
    clauses.push("a.handle = ?");
    args.push(h);
  }
  const q = opts.q?.trim();
  if (q) {
    clauses.push("(p.text LIKE ? OR pe.canonical_name LIKE ? OR a.handle LIKE ?)");
    args.push(`%${q}%`, `%${normalizeName(q)}%`, `%${q.toLowerCase()}%`);
  }
  return { where: `WHERE ${clauses.join(" AND ")}`, args };
}

const DISCOURSE_FROM = `
  FROM social_post_review r
  JOIN social_post p ON p.id = r.social_post_id
  JOIN social_account a ON a.id = p.social_account_id
  LEFT JOIN people pe ON pe.id = a.person_id`;

export function getDiscourseSummary(): {
  reviewed: number;
  total: number;
  accounts: number;
  bySeverity: Record<string, number>;
  byCategory: Record<string, number>;
} {
  const empty = { reviewed: 0, total: 0, accounts: 0, bySeverity: {}, byCategory: {} };
  if (!hasTable("social_post_review")) return empty;
  const reviewed = (db().prepare("SELECT count(*) AS n FROM social_post_review").get() as { n: number }).n;
  const total = (
    db().prepare("SELECT count(*) AS n FROM social_post_review WHERE is_offensive = 1").get() as { n: number }
  ).n;
  const accounts = (
    db()
      .prepare(
        `SELECT count(DISTINCT p.social_account_id) AS n
         FROM social_post_review r JOIN social_post p ON p.id = r.social_post_id
         WHERE r.is_offensive = 1`
      )
      .get() as { n: number }
  ).n;
  const bySeverity: Record<string, number> = {};
  for (const row of db()
    .prepare("SELECT severity, count(*) AS n FROM social_post_review WHERE is_offensive = 1 GROUP BY severity")
    .all() as Array<{ severity: string; n: number }>) {
    if (row.severity) bySeverity[row.severity] = row.n;
  }
  const byCategory: Record<string, number> = {};
  for (const row of db()
    .prepare("SELECT categories FROM social_post_review WHERE is_offensive = 1")
    .all() as Array<{ categories: string }>) {
    try {
      for (const c of JSON.parse(row.categories) as string[]) byCategory[c] = (byCategory[c] ?? 0) + 1;
    } catch {
      /* skip */
    }
  }
  return { reviewed, total, accounts, bySeverity, byCategory };
}

export function getDiscourseCount(opts: {
  category?: string;
  severity?: string;
  group?: boolean;
  handle?: string;
  q?: string;
}): number {
  if (!hasTable("social_post_review")) return 0;
  const { where, args } = discourseWhere(opts);
  return (
    db().prepare(`SELECT count(*) AS n ${DISCOURSE_FROM} ${where}`).get(...args) as { n: number }
  ).n;
}

const DISCOURSE_SEVERITY_RANK = "CASE r.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END";

export function getDiscourseSignals(opts: {
  category?: string;
  severity?: string;
  group?: boolean;
  handle?: string;
  q?: string;
  limit?: number;
  offset?: number;
}): DiscourseSignal[] {
  if (!hasTable("social_post_review")) return [];
  const limit = opts.limit ?? 30;
  const offset = opts.offset ?? 0;
  const { where, args } = discourseWhere(opts);
  const rows = db()
    .prepare(
      `SELECT p.id AS postId, a.handle AS handle, a.person_id AS personId,
              pe.canonical_name AS personName,
              (SELECT ph.party_abbr FROM politician_history ph
                 WHERE ph.person_id = a.person_id AND ph.result LIKE 'ELEITO%'
                 ORDER BY ph.year DESC LIMIT 1) AS party,
              (SELECT ph.state FROM politician_history ph
                 WHERE ph.person_id = a.person_id AND ph.result LIKE 'ELEITO%'
                 ORDER BY ph.year DESC LIMIT 1) AS state,
              p.kind AS kind, p.text AS text, p.url AS url, p.posted_at AS postedAt,
              p.matched_terms AS matchedTerms, p.reply_to_handle AS replyToHandle,
              r.severity AS severity, r.categories AS categories, r.quote AS quote,
              r.explanation AS explanation
       ${DISCOURSE_FROM}
       ${where}
       ORDER BY ${DISCOURSE_SEVERITY_RANK}, p.posted_at DESC, p.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...args, limit, offset) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    postId: r.postId as number,
    handle: r.handle as string,
    personId: (r.personId as number) ?? null,
    personName: (r.personName as string) ?? null,
    party: (r.party as string) ?? null,
    state: (r.state as string) ?? null,
    kind: r.kind as string,
    text: r.text as string,
    url: (r.url as string) ?? null,
    postedAt: (r.postedAt as string) ?? null,
    matchedTerms: safeJsonArray(r.matchedTerms as string),
    severity: (r.severity as DiscourseSeverity) ?? null,
    categories: safeJsonArray(r.categories as string),
    quote: (r.quote as string) ?? null,
    explanation: (r.explanation as string) ?? null,
    replyToHandle: (r.replyToHandle as string) ?? null,
  }));
}

function safeJsonArray(s: string | null): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}
