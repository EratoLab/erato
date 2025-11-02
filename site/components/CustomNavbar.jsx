"use client";

import { Navbar } from "nextra-theme-docs";
import GitHubButton from "./GitHubButton";

export default function CustomNavbar() {
  return (
    <Navbar
      logo={
        <img
          src="/erato_logo.svg"
          alt="Erato Logo"
          style={{
            height: 32,
            width: "auto",
            display: "inline-block",
            verticalAlign: "middle",
          }}
        />
      }
    >
      <GitHubButton />
    </Navbar>
  );
}
