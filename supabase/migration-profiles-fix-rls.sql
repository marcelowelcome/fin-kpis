-- Fix: RLS policies com recursão infinita
-- Problema: policy lia a própria tabela profiles para verificar role → loop
-- Solução: policy simples — authenticated pode ler tudo, escrita via service role

-- Remover policies com recursão
DROP POLICY IF EXISTS "Users can read own profile" ON profiles;
DROP POLICY IF EXISTS "Admins can read all profiles" ON profiles;
DROP POLICY IF EXISTS "Admins can manage profiles" ON profiles;

-- Nova policy: qualquer autenticado pode ler todos os profiles
-- (é uma ferramenta interna, não há dados sensíveis nos profiles)
CREATE POLICY "Authenticated can read profiles"
  ON profiles FOR SELECT TO authenticated
  USING (true);

-- Escrita: apenas via service role key (API Routes)
-- Não precisa de policy para INSERT/UPDATE/DELETE pois as API Routes
-- usam getSupabaseServer() que bypassa RLS com service role key
