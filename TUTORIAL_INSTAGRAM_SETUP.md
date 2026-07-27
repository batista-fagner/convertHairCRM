# Tutorial: conectar uma conta Instagram na automação (convertHairCRM)

Passo a passo pra ligar a automação de comentários/DM do Instagram (aba "IG Automação" do CRM) numa conta nova. Repita isso pra cada cliente novo.

## O que você vai precisar antes de começar

- Acesso a uma conta [developers.facebook.com](https://developers.facebook.com) (a sua, de desenvolvedor — não precisa ser a do cliente)
- Login e senha da conta **Instagram profissional** do cliente (ele te passa, você só usa no momento de autorizar — não precisa saber a senha de cor nem guardar)
- Acesso ao Railway do projeto (pra colocar as variáveis de ambiente)

---

## Passo 1 — Criar o app no Meta Developer

1. Acesse [developers.facebook.com/apps](https://developers.facebook.com/apps)
2. **Criar app** → tipo **"Business"**
3. Dá um nome pro app (ex: `CRM-IA-NomeDoCliente`)

## Passo 2 — Adicionar o caso de uso "Instagram"

1. Dentro do app, vá em **Casos de uso** → **Adicionar casos de uso**
2. Filtre por **"Gerenciamento de conteúdo"**
3. Selecione **"Gerenciar mensagens e conteúdo no Instagram"** → Salvar

Isso cria automaticamente um "app do Instagram" vinculado (nome tipo `NomeDoApp-IG`).

## Passo 3 — Adicionar as permissões obrigatórias

1. No caso de uso do Instagram, vá em **"Configuração da API com login..."**
2. Na seção **"1. Adicionar permissões obrigatórias de mensagens"**, clique em **"Add all required permissions"**
3. As 3 permissões (`instagram_business_basic`, `instagram_business_manage_comments`, `instagram_business_manage_messages`) devem ficar com ✓ verde

## Passo 4 — Autorizar a conta Instagram do cliente como Testador

**Antes de conseguir gerar o token**, a conta Instagram do cliente precisa ter a função de "Testador do Instagram" no app:

1. No menu lateral do app, vá em **Funções do app → Funções**
2. Clique em **Adicionar pessoas**
3. Selecione **"Testador do Instagram"**
4. Digite o `@usuário` do Instagram do cliente e adicione
5. Isso fica como **Pendente** até o cliente aceitar

**O cliente precisa aceitar o convite:**
1. Ele entra no app do Instagram (ou instagram.com) com a conta dele
2. Vai em **Configurações → Apps e sites** (ou "Aplicativos e sites")
3. Aba de **convites de testador** → aceitar o convite do seu app

Depois de aceito, o status na tela de Funções deixa de mostrar "Pendente".

## Passo 5 — Conectar a conta e gerar o token

1. Volte em **Casos de uso → API do Instagram → Configuração da API com login...**
2. Na seção **"2. Gerar tokens de acesso"**, clique em **Adicionar conta**
3. Clique em **Continuar** — vai abrir uma tela de login do Instagram
4. **Aqui você (ou o cliente) faz login com usuário/senha da conta Instagram dele** — só nesse momento específico
5. Autoriza o app
6. A conta aparece na lista com o **ID do Instagram** já visível (isso é o `IG_USER_ID`)
7. Clique em **Gerar token** — vai abrir uma nova autorização (pode pedir login de novo)
8. Marque **"Estou ciente"** e copie o **token de acesso** (começa com `IGAAV...`) — esse é o `IG_TOKEN`

⚠️ O token só é mostrado **uma vez**. Copie e cole direto onde for usar, sem fechar a tela antes.

## Passo 6 — Configurar as variáveis no Railway

No serviço do backend (Railway), adicione 3 variáveis:

```
IG_TOKEN=IGAAV... (o token gerado no passo 5)
IG_USER_ID=178414... (o ID mostrado no passo 5)
IG_WEBHOOK_VERIFY_TOKEN=qualquer-string-que-voce-escolher (ex: convert-ig-2026)
```

Comando (rodando localmente com Railway CLI já logado):
```bash
railway variables --service <nome-do-servico> \
  --set "IG_TOKEN=..." \
  --set "IG_USER_ID=..." \
  --set "IG_WEBHOOK_VERIFY_TOKEN=..."
```

Isso reinicia o serviço automaticamente com as novas variáveis.

## Passo 7 — Configurar o webhook

Ainda na tela **"Configuração da API com login..."**, seção **"3. Configurar webhooks"**:

- **URL de callback**: `https://<url-do-backend>/api/ig-auto/webhook`
- **Verificar token**: o mesmo valor que você colocou em `IG_WEBHOOK_VERIFY_TOKEN`

Clique em **Verificar e salvar**. Se dois dá erro "não foi possível validar":
- Confira se a URL está certa (o prefixo `/api` é importante — o backend usa `app.setGlobalPrefix('api')`)
- Confirme que a variável já propagou no Railway (pode levar ~1 min pra reiniciar)
- Teste manualmente: `curl "https://<url>/api/ig-auto/webhook?hub.mode=subscribe&hub.verify_token=<seu-token>&hub.challenge=12345"` — deve devolver `12345`

Quando der certo, a etapa 3 fica com ✓ verde.

## Passo 8 — Ativar a assinatura do webhook

Na seção **"2. Gerar tokens de acesso"**, ao lado da conta conectada, tem a coluna **"Assinatura do webhook"** — clique no toggle pra deixar **Ativado**.

## Passo 9 — Publicar o app

⚠️ **Passo fácil de esquecer, mas essencial**: enquanto o app estiver "Não publicado", o Instagram **não entrega nenhum evento real** (nem comentário nem DM), mesmo com a conta marcada como testadora.

1. No menu lateral, vá em **Publicar**
2. Publique o app

Depois de publicado, os testes reais (comentar no post, mandar DM) já devem disparar o webhook de verdade.

## Passo 10 — Criar a automação no CRM

Já no painel do CRM (`/instagram-auto` ou "IG Automação" no menu):

1. **Nova Automação**
2. Selecione o post/reel
3. Defina a palavra-chave (ou marque "disparar para qualquer comentário")
4. Preencha a mensagem de contexto e o link (se for redirecionar pro WhatsApp, use um link `wa.me` com texto pré-preenchido, ex: `https://wa.me/<numero>?text=Vim%20do%20Instagram%2C%20quero%20saber%20mais!` — isso permite o SDR identificar a origem automaticamente)
5. Se quiser IA conduzindo a conversa: marque **"Usar IA"** e escreva o prompt

---

## Checklist rápido de verificação

- [ ] App criado + caso de uso Instagram adicionado
- [ ] 3 permissões com ✓ verde
- [ ] Conta do cliente aceitou o convite de testador
- [ ] Conta conectada, `IG_USER_ID` e `IG_TOKEN` copiados
- [ ] Variáveis configuradas no Railway
- [ ] Webhook validado (✓ verde na etapa 3)
- [ ] Assinatura do webhook **Ativado**
- [ ] App **Publicado**
- [ ] Automação criada no CRM

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| Comentário/DM não dispara nada | App não publicado (passo 9) |
| Erro 403 ao mandar a 1ª mensagem de um fluxo (confirmação/captura de email) | Já corrigido no código — usa `comment_id` em vez de `user id` pra iniciar a conversa |
| Webhook não valida | URL sem o prefixo `/api`, ou variável ainda não propagou no Railway |
| "Função de desenvolvedor é insuficiente" ao logar com a conta do cliente | Cliente ainda não tem a função de Testador do Instagram (passo 4) |
| Automação responde em loop, replicando a própria resposta | Já corrigido no código — ignora comentários feitos pela própria conta conectada |
