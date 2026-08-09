import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY. Run this script with these environment variables set.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data, error } = await supabase.from('recipes').select('id, author_name').is('author_name', null);
  
  if (error) {
    console.error("Failed to fetch recipes:", error.message);
    process.exit(1);
  }
  
  console.log(`Found ${data.length} recipes without author_name.`);
  
  for (const row of data) {
    const randomName = `Anon-${Math.floor(1000 + Math.random() * 9000)}`;
    const { error: updateError } = await supabase.from('recipes').update({ author_name: randomName }).eq('id', row.id);
    
    if (updateError) {
      console.error(`Failed to update ${row.id}:`, updateError.message);
    } else {
      console.log(`Updated ${row.id} -> ${randomName}`);
    }
  }
  console.log("Database update completed.");
}

run();
