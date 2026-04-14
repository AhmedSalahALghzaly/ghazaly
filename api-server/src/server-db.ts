import { Pool, types } from "pg";

// Fix: PostgreSQL returns NUMERIC/DECIMAL types as strings by default.
// Override the parser to return floats instead.
// OID 1700 = NUMERIC, OID 700 = FLOAT4, OID 701 = FLOAT8
types.setTypeParser(1700, (val: string) => parseFloat(val));
types.setTypeParser(700, (val: string) => parseFloat(val));
types.setTypeParser(701, (val: string) => parseFloat(val));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

export default pool;

export async function query(text: string, params?: any[]) {
  const client = await pool.connect();
  try {
    const result = await client.query(text, params);
    return result;
  } finally {
    client.release();
  }
}
