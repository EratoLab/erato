"use client";

import { Fragment, forwardRef, useEffect, useId, useRef, useState } from "react";
import { Anchor, Button, Collapse } from "nextra/components";
import { useFSRoute, useHash } from "nextra/hooks";
import { ArrowRightIcon, ExpandIcon } from "nextra/icons";
import scrollIntoView from "scroll-into-view-if-needed";
import { LocaleSwitch, ThemeSwitch, setMenu, useConfig, useThemeConfig } from "nextra-theme-docs";
import { getSidebarIcon } from "./sidebarIcons";
import { ResolvedIcon } from "./icons/ResolvedIcon";

const TreeState = /* @__PURE__ */ Object.create(null);

function cn(...classes) {
  const result = [];

  for (const className of classes) {
    if (!className) {
      continue;
    }

    if (typeof className === "string" || typeof className === "number") {
      result.push(String(className));
      continue;
    }

    if (Array.isArray(className)) {
      const nestedClassName = cn(...className);
      if (nestedClassName) {
        result.push(nestedClassName);
      }
      continue;
    }

    if (typeof className === "object") {
      for (const [key, value] of Object.entries(className)) {
        if (value) {
          result.push(key);
        }
      }
    }
  }

  return result.join(" ");
}

const classes = {
  link: cn(
    "x:flex x:rounded x:px-2 x:py-1.5 x:text-sm x:transition-colors x:[word-break:break-word]",
    "x:cursor-pointer x:contrast-more:border",
    "x:items-center x:gap-2",
  ),
  inactive: cn(
    "x:text-gray-500 x:hover:bg-gray-100 x:hover:text-gray-900",
    "x:dark:text-neutral-400 x:dark:hover:bg-primary-100/5 x:dark:hover:text-gray-50",
    "x:contrast-more:text-gray-900 x:contrast-more:dark:text-gray-50",
    "x:contrast-more:border-transparent x:contrast-more:hover:border-gray-900 x:contrast-more:dark:hover:border-gray-50",
  ),
  active: cn(
    "x:bg-primary-100 x:font-semibold x:text-primary-800 x:dark:bg-primary-400/10 x:dark:text-primary-600",
    "x:contrast-more:border-primary-500!",
  ),
  list: cn("x:grid x:gap-1"),
  separator: cn("[word-break:break-word]"),
  border: cn(
    "x:relative x:before:absolute x:before:inset-y-1",
    'x:before:w-px x:before:bg-gray-200 x:before:content-[""] x:dark:before:bg-neutral-800',
    "x:ps-3 x:before:start-0 x:pt-1 x:ms-3",
  ),
  wrapper: cn("x:p-4 x:overflow-y-auto nextra-scrollbar nextra-mask"),
  footer: cn("nextra-sidebar-footer x:border-t nextra-border x:flex x:items-center x:gap-2 x:py-4 x:mx-4"),
};

const SidebarItemIcon = ({ icon }) => {
  if (!icon) {
    return null;
  }

  return <ResolvedIcon iconId={icon} className="x:size-1 x:shrink-0" />;
};

const Folder = ({ item: _item, anchors, level }) => {
  const routeOriginal = useFSRoute();
  const route = routeOriginal.split("#", 1)[0];
  const item = {
    ..._item,
    children: _item.type === "menu" ? getMenuChildren(_item) : _item.children,
  };
  const hasRoute = !!item.route;
  const active = hasRoute && [route, route + "/"].includes(item.route + "/");
  const activeRouteInside = active || (hasRoute && route.startsWith(item.route + "/"));
  const { theme } = item;
  const {
    defaultMenuCollapseLevel,
    autoCollapse,
  } = useThemeConfig().sidebar;
  const open =
    TreeState[item.route] === undefined
      ? activeRouteInside || (theme && "collapsed" in theme ? !theme.collapsed : level < defaultMenuCollapseLevel)
      : TreeState[item.route];
  const [, rerender] = useState();
  const handleClick = (event) => {
    const el = event.currentTarget;
    const isClickOnIcon = el !== event.target;
    if (isClickOnIcon) {
      event.preventDefault();
    }
    const isOpen = el.parentElement.classList.contains("open");
    TreeState[item.route] = !isOpen;
    rerender({});
  };

  useEffect(() => {
    const updateTreeState = function updateTreeState2() {
      if (activeRouteInside) {
        TreeState[item.route] = true;
      }
    };

    const updateAndPruneTreeState = function updateAndPruneTreeState2() {
      if (activeRouteInside) {
        TreeState[item.route] = true;
      } else {
        delete TreeState[item.route];
      }
    };

    if (autoCollapse) {
      updateAndPruneTreeState();
    } else {
      updateTreeState();
    }
  }, [activeRouteInside, item.route, autoCollapse]);

  const isLink = "frontMatter" in item;
  const ComponentToUse = isLink ? Anchor : Button;
  const icon = item.theme?.icon ?? getSidebarIcon(item);

  return (
    <li className={cn({ open, active })}>
          <ComponentToUse
        href={isLink ? item.route : undefined}
        data-href={isLink ? undefined : item.route}
        className={cn(
          "x:items-center x:justify-between x:gap-2",
          !isLink && "x:text-start x:w-full",
          classes.link,
          active ? classes.active : classes.inactive,
        )}
        onClick={handleClick}
      >
        <span className="x:flex x:items-center x:gap-2">
          <SidebarItemIcon icon={icon} />
          {item.title}
        </span>
        <ArrowRightIcon
          height="18"
          className={cn(
            "x:shrink-0",
            "x:rounded-sm x:p-0.5 x:hover:bg-gray-800/5 x:dark:hover:bg-gray-100/5",
            "x:motion-reduce:transition-none x:origin-center x:transition-all x:rtl:-rotate-180",
            open && "x:ltr:rotate-90 x:rtl:-rotate-270",
          )}
        />
      </ComponentToUse>
      {item.children && (
        <Collapse isOpen={open}>
          <Menu
            directories={item.children}
            anchors={anchors}
            className={classes.border}
            level={level}
          />
        </Collapse>
      )}
    </li>
  );
};

const Separator = ({ title }) => {
  const className = title
    ? "x:not-first:mt-5 x:mb-2 x:px-2 x:py-1.5 x:text-sm x:font-semibold x:text-gray-900 x:dark:text-gray-100"
    : "x:my-4";
  return (
    <li className={cn(classes.separator, className)}>
      {title ? title : <hr className="x:mx-2 x:border-t nextra-border" />}
    </li>
  );
};

const handleClick = () => {
  setMenu(false);
};

const File = ({ item, anchors }) => {
  const route = useFSRoute();
  const active = item.route && [route, route + "/"].includes(item.route + "/");
  const activeSlug = useHash().slice(1);
  if (item.type === "separator") {
    return <Separator title={item.title} />;
  }

  const href = item.href || item.route;
  const icon = item.theme?.icon ?? getSidebarIcon(item);

  return (
    <li className={cn({ active })}>
      <Anchor href={href} className={cn(classes.link, active ? classes.active : classes.inactive)}>
        <span className="x:flex x:items-center x:gap-2">
          <SidebarItemIcon icon={icon} />
          {item.title}
        </span>
      </Anchor>
      {active && anchors.length > 0 ? (
        <ul className={cn(classes.list, classes.border)}>
          {anchors.map(({ id, value }) => (
            <li key={id}>
              <a
                href={`#${id}`}
                className={cn(
                  'x:focus-visible:nextra-focus x:flex x:gap-2 x:before:opacity-25 x:before:content-["#"]',
                  id === activeSlug ? classes.active : classes.inactive,
                )}
                onClick={handleClick}
              >
                {value}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
};

const getMenuChildren = (menu) => {
  const routes = Object.fromEntries((menu.children || []).map((route) => [route.name, route]));
  return Object.entries(menu.items || {}).map(([key, item]) => ({
    ...routes[key] || {
      name: key,
    },
    ...item,
  }));
};

const Menu = forwardRef(({ directories, anchors, className, level }, forwardedRef) => {
  return (
    <ul className={cn(classes.list, className)} ref={forwardedRef}>
      {directories.map((item) => {
        const ComponentToUse = item.type === "menu" || item.children?.length ? Folder : File;
        return (
          <ComponentToUse
            item={item}
            anchors={anchors}
            level={level + 1}
            key={item.name}
          />
        );
      })}
    </ul>
  );
});
Menu.displayName = "Menu";

let lastScrollPosition = 0;
const handleScrollEnd = (event) => {
  lastScrollPosition = event.currentTarget.scrollTop;
};

const Sidebar = ({ toc }) => {
  const {
    normalizePagesResult,
    hideSidebar,
  } = useConfig();
  const themeConfig = useThemeConfig();
  const [isExpanded, setIsExpanded] = useState(themeConfig.sidebar.defaultOpen);
  const [showToggleAnimation, setToggleAnimation] = useState(false);
  const sidebarRef = useRef(null);
  const sidebarControlsId = useId();
  const { docsDirectories, activeThemeContext } = normalizePagesResult;
  const includePlaceholder = activeThemeContext.layout === "default";
  const anchors = themeConfig.toc.float ? [] : (toc || []).filter((item) => item.depth === 2);
  const hasI18n = themeConfig.i18n.length > 0;
  const hasMenu = themeConfig.darkMode || hasI18n || themeConfig.sidebar.toggleButton;

  useEffect(() => {
    if (window.innerWidth < 768) {
      return;
    }
    const sidebar = sidebarRef.current;
    if (lastScrollPosition) {
      sidebar.scrollTop = lastScrollPosition;
      return;
    }
    const activeLink = sidebar.querySelector("li.active");
    if (activeLink) {
      scrollIntoView(activeLink, {
        block: "center",
        inline: "center",
        scrollMode: "always",
        boundary: sidebar.parentNode,
      });
    }
  }, []);

  const placeholder = includePlaceholder && hideSidebar ? <div className="x:max-xl:hidden x:h-0 x:w-64 x:shrink-0" /> : null;

  return (
    <Fragment>
      {placeholder}
      <aside
        id={sidebarControlsId}
        className={cn(
          "nextra-sidebar x:print:hidden",
          "x:transition-all x:ease-in-out",
          "x:max-md:hidden x:flex x:flex-col",
          "x:h-[calc(100dvh-var(--nextra-menu-height))]",
          "x:top-(--nextra-navbar-height) x:shrink-0",
          isExpanded ? "x:w-64" : "x:w-20",
          hideSidebar ? "x:hidden" : "x:sticky",
        )}
      >
        <div className={cn(classes.wrapper, "x:grow", !isExpanded && "no-scrollbar")} ref={sidebarRef} onScrollEnd={handleScrollEnd}>
          {(!hideSidebar || !isExpanded) && (
            <Collapse isOpen={isExpanded} horizontal>
              <Menu directories={docsDirectories} anchors={anchors} level={0} />
            </Collapse>
          )}
        </div>
        {hasMenu && (
          <div
            className={cn(
              "x:sticky x:bottom-0 x:bg-nextra-bg",
              classes.footer,
              !isExpanded && "x:flex-wrap x:justify-center",
              showToggleAnimation &&
                [
                  "x:*:opacity-0",
                  isExpanded ? "x:*:animate-[fade-in_1s_ease_.2s_forwards]" : "x:*:animate-[fade-in2_1s_ease_.2s_forwards]",
                ],
            )}
          >
            <LocaleSwitch lite={!isExpanded} className={isExpanded ? "x:grow" : ""} />
            <ThemeSwitch
              lite={!isExpanded || hasI18n}
              className={!isExpanded || hasI18n ? "" : "x:grow"}
            />
            {themeConfig.sidebar.toggleButton && (
              <Button
                aria-expanded={isExpanded}
                aria-controls={sidebarControlsId}
                title={isExpanded ? "Collapse sidebar" : "Expand sidebar"}
                className={cn(
                  "x:rounded-md x:p-2",
                  showToggleAnimation ? "" : isExpanded ? "x:text-gray-600 x:dark:text-gray-400" : "x:bg-gray-100 x:text-gray-900 x:dark:bg-primary-100/5 x:dark:text-gray-50",
                )}
                onClick={() => {
                  setIsExpanded((prev) => !prev);
                  setToggleAnimation(true);
                }}
              >
                <ExpandIcon
                  height="12"
                  className={cn(!isExpanded && "x:*:first:origin-[35%] x:*:first:rotate-180")}
                />
              </Button>
            )}
          </div>
        )}
      </aside>
    </Fragment>
  );
};

export { Sidebar };
