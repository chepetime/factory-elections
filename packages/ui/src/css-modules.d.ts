// Components style their effects with CSS modules; the apps' bundlers load them.
declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}
