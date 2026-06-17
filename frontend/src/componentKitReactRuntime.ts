import React from "react";

(window as Window & { ERATO_REACT?: typeof React }).ERATO_REACT = React;
