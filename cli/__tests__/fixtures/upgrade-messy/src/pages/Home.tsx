import { useHC, type HomePageData } from '@hostcore/toolkit'

export function HomeView() {
  const { data } = useHC<HomePageData>()
  const { hero, faq } = data.content
  return (
    <section>
      <h1>{hero.title}</h1>
      <p>{hero.subtitle}</p>
      <a href={hero.primary_cta.href}>{hero.primary_cta.label}</a>
      {faq.items.map((item) => (
        <details key={item.question}>
          <summary>{item.question}</summary>
          {item.answer}
        </details>
      ))}
      <ul>
        {data.service_groups.map((g) => (
          <li key={g.id}>{g.name}</li>
        ))}
      </ul>
    </section>
  )
}
