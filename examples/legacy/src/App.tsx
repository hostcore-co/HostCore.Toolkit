import { useHC, type GroupPageData, type HomePageData } from '@hostcore/toolkit'
import './styles.css'

/**
 * A format-1 template: one App that switches on the page type and reads
 * contract "1" data.
 */
export function App() {
  const { data, store } = useHC()
  switch (data.page_type) {
    case 'home': {
      const home = data as HomePageData
      return (
        <main>
          <h1>{home.content.hero.title}</h1>
          <p>{store.store_name}</p>
        </main>
      )
    }
    case 'group': {
      const group = data as GroupPageData
      return (
        <main>
          <h1>{group.group.name}</h1>
        </main>
      )
    }
    default:
      return (
        <main>
          <h1>{data.meta.title}</h1>
        </main>
      )
  }
}
