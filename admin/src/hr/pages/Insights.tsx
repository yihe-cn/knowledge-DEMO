import { I } from '../icons';
import { PageHeader } from '../components/primitives';
import { FAQS, COVERAGE, DEPARTMENTS } from '../data';

export default function Insights() {
  return (
    <>
      <PageHeader
        crumbs={['审核运营', '问答洞察']}
        title="医生和代表在问什么？"
        desc="本视图基于代表移动端 / 医生学术助手 的最近 30 天检索日志（mock 数据，待真实日志接口接入后替换）。"
        actions={<>
          <span className="seg">
            <button>近 7 天</button>
            <button className="on">近 30 天</button>
            <button>本季度</button>
          </span>
          <button className="btn"><I.External /> 导出报表</button>
        </>}
      />

      <div className="kpi-grid">
        <div className="kpi featured">
          <div className="label">检索总次数</div>
          <div className="value mono">12,438</div>
          <div className="trend">命中 8,712 · 未命中 3,726</div>
        </div>
        <div className="kpi">
          <div className="label">命中率</div>
          <div className="value mono">70%</div>
          <div className="trend down">较上月 -4pp</div>
        </div>
        <div className="kpi">
          <div className="label">人均提问</div>
          <div className="value mono">3.8<span className="unit">次/月</span></div>
          <div className="trend up">↑ 0.4 · 入职旺季驱动</div>
        </div>
        <div className="kpi">
          <div className="label">需新建条目</div>
          <div className="value mono" style={{ color: 'var(--st-expiring-fg)' }}>17</div>
          <div className="trend">基于聚类后的未命中问题</div>
        </div>
      </div>

      <div className="grid-2">
        <div className="col">
          <div className="card flush">
            <div className="card-h">
              <h2 className="h2"><I.Flame /> 未命中查询（聚类后）</h2>
              <button className="btn sm">批量建为条目 <I.Arrow /></button>
            </div>
            <div>
              {FAQS.filter(f => !f.hit).concat([
                { q: 'Opal 系统能否兼容外院 CT 数据格式？',     hits: 64, hit: false },
                { q: '脉冲消融在儿童 SVT 是否有适应症？',       hits: 52, hit: false },
                { q: '术中如果导管贴靠不稳定，能临时切换标测吗？', hits: 48, hit: false },
              ]).map((f, i) => (
                <div key={i} style={{
                  display: 'grid', gridTemplateColumns: '44px 1fr auto auto',
                  alignItems: 'center', gap: 12,
                  padding: '12px 16px', borderBottom: '1px solid var(--divider)',
                }}>
                  <div style={{
                    height: 24, borderRadius: 4,
                    background: 'var(--st-expiring-bg)', color: 'var(--st-expiring-fg)',
                    display: 'grid', placeItems: 'center',
                    fontFamily: 'var(--ff-mono)', fontSize: 11, fontWeight: 600,
                  }}>{f.hits}</div>
                  <div style={{ fontSize: 13 }}>{f.q}</div>
                  <span className="tag">建议：临床应用</span>
                  <button className="btn ghost sm">建为条目 <I.Plus /></button>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h2 className="h2"><I.Layers /> 分类命中率</h2>
              <span className="mono muted" style={{ fontSize: 11 }}>越低越值得补内容</span>
            </div>
            {[
              { cat: '产品知识', hit: 92, q: 4120 },
              { cat: '原理科普', hit: 84, q: 3210 },
              { cat: '临床应用', hit: 78, q: 1840 },
              { cat: '销售话术', hit: 88, q: 1280 },
              { cat: '临床技术', hit: 71, q: 980 },
              { cat: '临床数据', hit: 64, q: 540 },
              { cat: '医学诊断', hit: 58, q: 420 },
              { cat: '临床研究', hit: 46, q: 210 },
            ].map((r, i) => (
              <div key={i} className={'bar-row' + (r.hit < 60 ? ' alt' : '')}>
                <div className="bar-l">{r.cat}</div>
                <div className="bar-bg"><div className="bar-fg" style={{ width: r.hit + '%' }} /></div>
                <div className="bar-v">{r.hit}% · {r.q}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="col">
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h2 className="h2"><I.Brain /> 知识覆盖矩阵</h2>
              <span className="mono muted" style={{ fontSize: 11 }}>分类 × 部门</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
              数值为该分类下，该部门员工最近 30 天检索的命中率。深色 = 覆盖充分。
            </div>
            <div className="heat">
              <div className="heat-row">
                <div className="heat-l" />
                {DEPARTMENTS.slice(0, 7).map(d => <div key={d.code} className="heat-h">{d.code}</div>)}
                <div className="heat-h" style={{ visibility: 'hidden' }}>x</div>
              </div>
              {COVERAGE.map((row, i) => (
                <div key={i} className="heat-row">
                  <div className="heat-l">{row.cat}</div>
                  {row.vals.map((v, j) => {
                    const a = v / 100;
                    return (
                      <div key={j} className="heat-c"
                           style={{
                             background: `rgba(32, 53, 92, ${0.18 + a * 0.65})`,
                             color: a > 0.55 ? 'rgba(255,255,255,0.95)' : 'rgba(20,28,48,0.7)',
                           }}>
                        {v}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            <div style={{ marginTop: 12, padding: 10, background: 'var(--surface-2)', borderRadius: 6, fontSize: 12, color: 'var(--ink-2)' }}>
              <b>洞察：</b>西北 / 西南 / 东北大区在"临床研究"维度命中率均 ≤ 48%，建议优先补充 PAX 二代导管 PVI+ 与脉冲消融食道损伤相关的研究类条目，并安排区域内部专题培训。
            </div>
          </div>

          <div className="card">
            <h2 className="h2" style={{ marginBottom: 12 }}><I.Eye /> 最近未命中样本</h2>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
              逐条查看可识别表述差异（"贴靠/接触/反折"）或临床空白。
            </div>
            {[
              { who: '华东 · 代表周凯', q: '医生问 PAX 二代导管能不能做心耳隔离？', t: '2 小时前', suggest: '产品知识' },
              { who: '西南 · 代表林岚', q: '医院 IT 问 Opal 数据能不能导出做科研？', t: '3 小时前', suggest: '（无对应条目）' },
              { who: '华北 · 代表韩晓', q: 'KOL 想看 PAX 与 RF 消融的长期复发率对比？', t: '今天', suggest: '临床研究' },
            ].map((s, i) => (
              <div key={i} style={{
                padding: '10px 0', borderBottom: '1px solid var(--divider)',
                display: 'flex', flexDirection: 'column', gap: 4,
              }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--ff-mono)' }}>{s.t} · {s.who}</div>
                <div style={{ fontSize: 13 }}>"{s.q}"</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>建议归类：<span className="tag" style={{ marginLeft: 2 }}>{s.suggest}</span></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
