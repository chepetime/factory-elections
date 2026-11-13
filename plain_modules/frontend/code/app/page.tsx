import components from "../resources/frontend-component-placeholders.json";

// App shell inspiration: https://www.affectui.com/screens/app-shell-flat
export default function Home() {
  return (
    <div className="shell">
      <header className="shell-header">
        <h1>Software Factory</h1>
        <nav aria-label="Page sections">
          <a href="#components">Components</a>
          <a href="#data-contracts">Data contracts</a>
        </nav>
      </header>
      <main className="content">
        <section id="components" aria-labelledby="components-heading">
          <h2 id="components-heading">Components</h2>
          <div className="card-grid">
            {components.map((name) => (
              <article className="card" key={name}>
                <h3>{name}</h3>
                <p>Not connected</p>
              </article>
            ))}
          </div>
        </section>
        <section id="data-contracts" aria-labelledby="data-contracts-heading">
          <h2 id="data-contracts-heading">Data contracts</h2>
          <p>Not connected to backend</p>
        </section>
      </main>
    </div>
  );
}
