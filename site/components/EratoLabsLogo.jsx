export default function EratoLabsLogo({ className = "" }) {
  return (
    <>
      <img
        alt=""
        aria-hidden="true"
        className={`block dark:hidden ${className}`}
        height="200"
        src="/erato-labs_logo_product_black.svg"
        width="620"
      />
      <img
        alt=""
        aria-hidden="true"
        className={`hidden dark:block ${className}`}
        height="200"
        src="/erato-labs_logo_product_white.svg"
        width="620"
      />
    </>
  );
}
