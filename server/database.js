export function database(pool) {
 return async function transaction(actor,work){
  const client=await pool.connect();
  try{
   await client.query('BEGIN');await client.query('SET LOCAL ROLE dinig_runtime');
   await client.query("SELECT set_config('dinig.staff_id',$1,true),set_config('dinig.report_id',$2,true),set_config('dinig.creating',$3,true)",[actor?.staffId||'',actor?.reportId||'',actor?.creating?'yes':'']);
   const value=await work(client);await client.query('COMMIT');return value;
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 };
}
