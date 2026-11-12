// PDF da Auditoria de Instagram — gerado no navegador (@react-pdf/renderer),
// carregado só quando clica em "Gerar PDF" (import dinâmico na página).
// Página 1 = capa de impacto (nota, manchete, 3 alertas, custo de esperar,
// convite pra ligação). Depois: notas + diagnóstico, erros, plano de 7 dias.
import { Document, Page, View, Text, Image, StyleSheet, Font, pdf } from '@react-pdf/renderer'

// Sem hifenização automática (ela segue regras do inglês e parte palavra em português).
Font.registerHyphenationCallback((word) => [word])

const C = {
  paper: '#FFFDF9',
  ink: '#1D1A16',
  body: '#3D3730',
  muted: '#7A7064',
  line: '#E9E0D2',
  gold: '#B07D2B',
  goldDeep: '#8A5F1C',
  goldSoft: '#F6EEDF',
  red: '#B42318',
  redSoft: '#FCEDEA',
  amber: '#B26B00',
  green: '#2F7D4F',
}

// Helvetica do PDF só tem o alfabeto latino: tira emoji e letra "estilizada".
const KEEP = '–—‘’“”•…€'
const clean = (t) =>
  String(t ?? '')
    .normalize('NFKC')
    .split('')
    .filter((ch) => ch.charCodeAt(0) <= 0xff || KEEP.includes(ch))
    .join('')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()

const nota = (n) => (typeof n === 'number' ? n.toFixed(1).replace('.', ',') : '-')
const scoreColor = (n) => (n >= 7 ? C.green : n >= 5 ? C.amber : C.red)
const verdictColor = (r) => (r === 'Sim' ? C.green : r === 'Parcialmente' ? C.amber : C.red)
const fmtInt = (n) => (n === null || n === undefined || n === '' ? '-' : Number(n).toLocaleString('pt-BR'))

const s = StyleSheet.create({
  page: { backgroundColor: C.paper, color: C.body, fontFamily: 'Helvetica', fontSize: 10, paddingTop: 34, paddingBottom: 46, paddingHorizontal: 40 },
  topbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: C.line, paddingBottom: 8, marginBottom: 18 },
  brand: { fontFamily: 'Helvetica-Bold', fontSize: 8, letterSpacing: 1.6, color: C.gold },
  topRight: { fontSize: 8, color: C.muted },
  footer: { position: 'absolute', bottom: 22, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between', fontSize: 7.5, color: C.muted },

  // capa
  profileRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 22 },
  pic: { width: 54, height: 54, borderRadius: 27, marginRight: 12, borderWidth: 2, borderColor: C.gold },
  handle: { fontFamily: 'Helvetica-Bold', fontSize: 14, color: C.ink },
  profileMeta: { fontSize: 9, color: C.muted, marginTop: 2 },
  scoreBox: { marginLeft: 'auto', alignItems: 'flex-end' },
  scoreNum: { fontFamily: 'Helvetica-Bold', fontSize: 40, lineHeight: 1 },
  scoreOf: { fontSize: 12, color: C.muted },
  scoreLabel: { fontSize: 7.5, color: C.muted, letterSpacing: 1, marginTop: 3 },
  gaugeTrack: { height: 5, backgroundColor: C.line, borderRadius: 3, marginBottom: 20 },
  gaugeFill: { height: 5, borderRadius: 3 },
  eyebrow: { fontFamily: 'Helvetica-Bold', fontSize: 8, letterSpacing: 1.4, color: C.gold, marginBottom: 6 },
  headline: { fontFamily: 'Helvetica-Bold', fontSize: 27, lineHeight: 1.18, color: C.ink, marginBottom: 10 },
  sub: { fontSize: 12.5, lineHeight: 1.5, color: C.body, marginBottom: 24 },
  alertRow: { flexDirection: 'row', gap: 8, marginBottom: 22 },
  alert: { flex: 1, backgroundColor: C.redSoft, borderRadius: 6, padding: 13 },
  alertNum: { fontFamily: 'Helvetica-Bold', fontSize: 24, color: C.red, marginBottom: 6 },
  alertTitle: { fontFamily: 'Helvetica-Bold', fontSize: 9.5, color: C.ink, marginBottom: 3 },
  alertText: { fontSize: 9, lineHeight: 1.45, color: C.body },
  costBox: { borderLeftWidth: 3, borderLeftColor: C.gold, backgroundColor: C.goldSoft, padding: 14, marginBottom: 20 },
  costTitle: { fontFamily: 'Helvetica-Bold', fontSize: 9, letterSpacing: 1, color: C.goldDeep, marginBottom: 4 },
  costText: { fontSize: 11.5, lineHeight: 1.5, color: C.ink },
  ctaBox: { backgroundColor: C.ink, borderRadius: 8, padding: 20 },
  ctaText: { fontFamily: 'Helvetica-Bold', fontSize: 14.5, lineHeight: 1.35, color: '#F3E3C3' },
  ctaSmall: { fontSize: 8.5, color: '#B9AE9F', marginTop: 6 },

  // páginas internas
  h2: { fontFamily: 'Helvetica-Bold', fontSize: 16, color: C.ink, marginBottom: 4 },
  lead: { fontSize: 9.5, color: C.muted, marginBottom: 14, lineHeight: 1.4 },
  catRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.line },
  catName: { width: 150, fontFamily: 'Helvetica-Bold', fontSize: 9.5, color: C.ink },
  catBarWrap: { width: 60, marginTop: 3, marginRight: 8 },
  catBarTrack: { height: 4, backgroundColor: C.line, borderRadius: 2 },
  catScore: { width: 26, fontFamily: 'Helvetica-Bold', fontSize: 9.5, textAlign: 'right', marginRight: 10 },
  catText: { flex: 1, fontSize: 8.8, lineHeight: 1.35, color: C.body },
  verdictGrid: { flexDirection: 'row', gap: 8, marginTop: 18, marginBottom: 10 },
  verdict: { flex: 1, borderWidth: 1, borderColor: C.line, borderRadius: 6, padding: 10 },
  verdictQ: { fontSize: 8, color: C.muted, marginBottom: 4, lineHeight: 1.3 },
  verdictA: { fontFamily: 'Helvetica-Bold', fontSize: 13, marginBottom: 4 },
  verdictWhy: { fontSize: 8.3, lineHeight: 1.35, color: C.body },
  gargalo: { backgroundColor: C.goldSoft, borderRadius: 6, padding: 12 },
  gargaloLabel: { fontFamily: 'Helvetica-Bold', fontSize: 8, letterSpacing: 1.2, color: C.goldDeep, marginBottom: 4 },
  gargaloText: { fontSize: 10.5, lineHeight: 1.45, color: C.ink, fontFamily: 'Helvetica-Bold' },

  err: { flexDirection: 'row', marginBottom: 11 },
  errNum: { width: 24, height: 24, borderRadius: 12, backgroundColor: C.ink, color: '#F3E3C3', fontFamily: 'Helvetica-Bold', fontSize: 11, textAlign: 'center', paddingTop: 6, marginRight: 10 },
  errBody: { flex: 1 },
  errTitle: { fontFamily: 'Helvetica-Bold', fontSize: 11, color: C.ink, marginBottom: 3 },
  errLine: { fontSize: 8.8, lineHeight: 1.4, color: C.body, marginBottom: 2 },
  errLabel: { fontFamily: 'Helvetica-Bold', color: C.ink },
  fix: { fontSize: 8.8, lineHeight: 1.4, color: C.green },

  opps: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  opp: { width: '48.8%', backgroundColor: C.goldSoft, borderRadius: 6, padding: 10 },
  oppTitle: { fontFamily: 'Helvetica-Bold', fontSize: 9.5, color: C.ink, marginBottom: 3 },
  oppText: { fontSize: 8.5, lineHeight: 1.35, color: C.body },
  day: { flexDirection: 'row', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.line },
  dayTag: { width: 46, fontFamily: 'Helvetica-Bold', fontSize: 9, color: C.gold },
  dayTitle: { fontFamily: 'Helvetica-Bold', fontSize: 9.5, color: C.ink, marginBottom: 2 },
  dayText: { fontSize: 8.8, lineHeight: 1.35, color: C.body },
  closing: { marginTop: 16, backgroundColor: C.ink, borderRadius: 8, padding: 14 },
})

function Top({ username, date }) {
  return (
    <View style={s.topbar} fixed>
      <Text style={s.brand}>AUDITORIA DE INSTAGRAM · CONVERT HAIR</Text>
      <Text style={s.topRight}>@{clean(username)} · {date}</Text>
    </View>
  )
}

function Footer() {
  return (
    <View style={s.footer} fixed>
      <Text>Análise feita com dados públicos do perfil. Stories não entram na análise.</Text>
      <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </View>
  )
}

export function AuditDocument({ audit }) {
  const a = audit.analysis || {}
  const d = audit.data || {}
  const p = d.profile || {}
  const capa = a.capa || {}
  const date = new Date(audit.createdAt).toLocaleDateString('pt-BR')
  const score = a.notaGeral ?? 0
  const pic = p.picDataUrl && /^data:image\/(jpe?g|png)/i.test(p.picDataUrl) ? p.picDataUrl : null
  const diag = a.diagnostico || {}
  const verdicts = [
    ['Transmite confiança pra quem nunca comprou com você?', diag.transmiteConfianca],
    ['Está pronto pra receber clientes vindos de anúncio?', diag.prontoParaAnuncios],
    ['Transforma seguidoras em compradoras?', diag.prontoParaConverter],
  ]

  return (
    <Document title={`Auditoria de Instagram - @${p.username || audit.username}`} author="Convert Hair">
      {/* ── Página 1: capa de impacto ── */}
      <Page size="A4" style={s.page}>
        <Top username={p.username || audit.username} date={date} />
        <View style={s.profileRow}>
          {pic && <Image src={pic} style={s.pic} />}
          <View>
            <Text style={s.handle}>@{clean(p.username || audit.username)}</Text>
            <Text style={s.profileMeta}>
              {clean(p.fullName)}{p.fullName ? ' · ' : ''}{fmtInt(p.followers)} seguidores
            </Text>
          </View>
          <View style={s.scoreBox}>
            <Text>
              <Text style={[s.scoreNum, { color: scoreColor(score) }]}>{nota(score)}</Text>
              <Text style={s.scoreOf}> / 10</Text>
            </Text>
            <Text style={s.scoreLabel}>NOTA DO SEU INSTAGRAM</Text>
          </View>
        </View>
        <View style={s.gaugeTrack}>
          <View style={[s.gaugeFill, { width: `${Math.max(3, score * 10)}%`, backgroundColor: scoreColor(score) }]} />
        </View>

        <Text style={s.eyebrow}>O QUE A ANÁLISE ENCONTROU</Text>
        <Text style={s.headline}>{clean(capa.manchete)}</Text>
        <Text style={s.sub}>{clean(capa.subtitulo)}</Text>

        <View style={s.alertRow}>
          {(capa.alertas || []).slice(0, 3).map((al, i) => (
            <View key={i} style={s.alert}>
              <Text style={s.alertNum}>{clean(al.numero)}</Text>
              <Text style={s.alertTitle}>{clean(al.titulo)}</Text>
              <Text style={s.alertText}>{clean(al.explicacao)}</Text>
            </View>
          ))}
        </View>

        <View style={s.costBox}>
          <Text style={s.costTitle}>O CUSTO DE DEIXAR COMO ESTÁ</Text>
          <Text style={s.costText}>{clean(capa.custoDeEsperar)}</Text>
        </View>

        <View style={s.ctaBox}>
          <Text style={s.ctaText}>{clean(capa.chamada)}</Text>
          <Text style={s.ctaSmall}>Nas próximas páginas: suas notas por área, os 5 pontos que mais travam suas vendas e um plano de 7 dias.</Text>
        </View>
        <Footer />
      </Page>

      {/* ── Página 2: notas + diagnóstico ── */}
      <Page size="A4" style={s.page}>
        <Top username={p.username || audit.username} date={date} />
        <Text style={s.h2}>Sua nota em cada área</Text>
        <Text style={s.lead}>De 0 a 10, do jeito que uma cliente nova enxerga o seu perfil na primeira visita.</Text>
        {(a.notas || []).map((n, i) => (
          <View key={i} style={s.catRow} wrap={false}>
            <Text style={s.catName}>{clean(n.categoria)}</Text>
            <View style={s.catBarWrap}>
              <View style={s.catBarTrack}>
                <View style={{ height: 4, borderRadius: 2, width: `${Math.max(4, (n.nota || 0) * 10)}%`, backgroundColor: scoreColor(n.nota || 0) }} />
              </View>
            </View>
            <Text style={[s.catScore, { color: scoreColor(n.nota || 0) }]}>{nota(n.nota)}</Text>
            <Text style={s.catText}>{clean(n.resumo)}</Text>
          </View>
        ))}

        <View style={s.verdictGrid} wrap={false}>
          {verdicts.map(([q, v], i) => (
            <View key={i} style={s.verdict}>
              <Text style={s.verdictQ}>{q}</Text>
              <Text style={[s.verdictA, { color: verdictColor(v?.resposta) }]}>{clean(v?.resposta || '-')}</Text>
              <Text style={s.verdictWhy}>{clean(v?.porque)}</Text>
            </View>
          ))}
        </View>
        <View style={s.gargalo} wrap={false}>
          <Text style={s.gargaloLabel}>SEU PRINCIPAL GARGALO HOJE</Text>
          <Text style={s.gargaloText}>{clean(diag.principalGargalo)}</Text>
        </View>
        <Footer />
      </Page>

      {/* ── Página 3: os 5 erros ── */}
      <Page size="A4" style={s.page}>
        <Top username={p.username || audit.username} date={date} />
        <Text style={s.h2}>Os 5 pontos que mais travam suas vendas</Text>
        <Text style={s.lead}>Em ordem de prioridade. Cada um com o que vimos no seu perfil e como resolver.</Text>
        {(a.erros || []).slice(0, 5).map((e, i) => (
          <View key={i} style={s.err} wrap={false}>
            <Text style={s.errNum}>{i + 1}</Text>
            <View style={s.errBody}>
              <Text style={s.errTitle}>{clean(e.titulo)}</Text>
              <Text style={s.errLine}><Text style={s.errLabel}>O que vimos: </Text>{clean(e.oQueVimos)}</Text>
              <Text style={s.errLine}><Text style={s.errLabel}>Por que importa: </Text>{clean(e.porQueImporta)}</Text>
              <Text style={s.fix}><Text style={s.errLabel}>Como resolver: </Text>{clean(e.comoResolver)}</Text>
            </View>
          </View>
        ))}
        <Footer />
      </Page>

      {/* ── Página 4: oportunidades + plano de 7 dias ── */}
      <Page size="A4" style={s.page}>
        <Top username={p.username || audit.username} date={date} />
        <Text style={s.h2}>Onde estão as suas oportunidades</Text>
        <Text style={s.lead}>O que dá pra fazer pra atrair mais clientes e vender mais.</Text>
        <View style={s.opps}>
          {(a.oportunidades || []).slice(0, 5).map((o, i) => (
            <View key={i} style={s.opp} wrap={false}>
              <Text style={s.oppTitle}>{clean(o.titulo)}</Text>
              <Text style={s.oppText}>{clean(o.descricao)}</Text>
            </View>
          ))}
        </View>
        <Text style={s.h2}>Seu plano de 7 dias</Text>
        <Text style={s.lead}>Uma ação por dia pra deixar o perfil pronto pra vender.</Text>
        {(a.plano7Dias || []).slice(0, 7).map((dd, i) => (
          <View key={i} style={s.day} wrap={false}>
            <Text style={s.dayTag}>DIA {dd.dia || i + 1}</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.dayTitle}>{clean(dd.titulo)}</Text>
              <Text style={s.dayText}>{clean(dd.acao)}</Text>
            </View>
          </View>
        ))}
        <View style={s.closing} wrap={false}>
          <Text style={s.ctaText}>{clean(capa.chamada)}</Text>
        </View>
        <Footer />
      </Page>
    </Document>
  )
}

/** Gera e baixa o PDF. */
export async function downloadAuditPdf(audit) {
  const blob = await pdf(<AuditDocument audit={audit} />).toBlob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `auditoria-instagram-${audit.data?.profile?.username || audit.username}.pdf`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
