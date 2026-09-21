// Ghostget site — shared behaviour. No build step, no dependencies (in keeping with the CLI itself).
// Created by SkyLostTR (@Keeftraum)
(function () {
  'use strict';

  var root = document.documentElement;
  var THEME_KEY = 'ghostget-theme';

  function applyTheme(theme) {
    if (theme === 'light' || theme === 'dark') {
      root.setAttribute('data-theme', theme);
    } else {
      root.removeAttribute('data-theme');
    }
    document.querySelectorAll('[data-theme-toggle]').forEach(function (btn) {
      var isLight = (theme === 'light') || (!theme && window.matchMedia('(prefers-color-scheme: light)').matches);
      btn.setAttribute('aria-label', isLight ? 'Switch to dark theme' : 'Switch to light theme');
    });
  }

  function initTheme() {
    var stored = null;
    try { stored = localStorage.getItem(THEME_KEY); } catch (e) { /* private mode */ }
    applyTheme(stored);

    document.querySelectorAll('[data-theme-toggle]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var current = root.getAttribute('data-theme') ||
          (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
        var next = current === 'light' ? 'dark' : 'light';
        applyTheme(next);
        try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* private mode */ }
      });
    });
  }

  function initMobileMenu() {
    var toggle = document.querySelector('[data-nav-toggle]');
    var menu = document.querySelector('[data-mobile-menu]');
    if (!toggle || !menu) return;
    toggle.addEventListener('click', function () {
      menu.classList.toggle('open');
      var expanded = menu.classList.contains('open');
      toggle.setAttribute('aria-expanded', String(expanded));
    });
    menu.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () { menu.classList.remove('open'); });
    });
  }

  function initCopyButtons() {
    document.querySelectorAll('.code-block[data-copy]').forEach(function (block) {
      var btn = block.querySelector('.copy-btn');
      if (!btn) return;
      btn.addEventListener('click', function () {
        var text = block.getAttribute('data-copy') || block.textContent || '';
        var done = function () {
          btn.classList.add('copied');
          btn.innerHTML = checkIcon();
          setTimeout(function () {
            btn.classList.remove('copied');
            btn.innerHTML = copyIcon();
          }, 1600);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text.trim()).then(done, done);
        } else {
          done();
        }
      });
    });
  }

  function copyIcon() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  }
  function checkIcon() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
  }

  function initFaqSingleOpen() {
    var items = document.querySelectorAll('.faq-item');
    items.forEach(function (item) {
      item.addEventListener('toggle', function () {
        if (item.open) {
          items.forEach(function (other) {
            if (other !== item) other.open = false;
          });
        }
      });
    });
  }

  function initBackToTop() {
    var btn = document.querySelector('[data-back-to-top]');
    if (!btn) return;
    window.addEventListener('scroll', function () {
      btn.classList.toggle('visible', window.scrollY > 600);
    }, { passive: true });
    btn.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  function initScrollSpy() {
    var links = document.querySelectorAll('.docs-nav-group a[href^="#"]');
    if (!links.length) return;
    var sections = [];
    links.forEach(function (link) {
      var id = link.getAttribute('href').slice(1);
      var el = document.getElementById(id);
      if (el) sections.push({ link: link, el: el });
    });
    if (!sections.length) return;

    function setActive(id) {
      links.forEach(function (l) { l.classList.remove('active'); });
      var match = sections.find(function (s) { return s.el.id === id; });
      if (match) match.link.classList.add('active');
    }

    var observer = new IntersectionObserver(function (entries) {
      var visible = entries.filter(function (e) { return e.isIntersecting; });
      if (visible.length) {
        visible.sort(function (a, b) { return a.boundingClientRect.top - b.boundingClientRect.top; });
        setActive(visible[0].target.id);
      }
    }, { rootMargin: '-15% 0px -70% 0px', threshold: [0, 1] });

    sections.forEach(function (s) { observer.observe(s.el); });

    if (location.hash) setActive(location.hash.slice(1));
  }

  function initDocsSearch() {
    var input = document.querySelector('[data-docs-search]');
    if (!input) return;
    var groups = document.querySelectorAll('.docs-nav-group');
    input.addEventListener('input', function () {
      var q = input.value.trim().toLowerCase();
      groups.forEach(function (group) {
        var anyVisible = false;
        group.querySelectorAll('li').forEach(function (li) {
          var text = li.textContent.toLowerCase();
          var show = !q || text.indexOf(q) !== -1;
          li.style.display = show ? '' : 'none';
          if (show) anyVisible = true;
        });
        group.style.display = anyVisible ? '' : 'none';
      });
    });
  }

  function typeTerminal() {
    var el = document.querySelector('[data-typed-terminal]');
    if (!el) return;
    var lines = Array.prototype.slice.call(el.querySelectorAll('[data-type]'));
    if (!lines.length) return;
    lines.forEach(function (l) { l.style.visibility = 'hidden'; });

    var i = 0;
    function showNext() {
      if (i >= lines.length) return;
      var line = lines[i];
      line.style.visibility = 'visible';
      i += 1;
      setTimeout(showNext, 140);
    }
    setTimeout(showNext, 300);
  }

  document.addEventListener('DOMContentLoaded', function () {
    initTheme();
    initMobileMenu();
    initCopyButtons();
    initFaqSingleOpen();
    initBackToTop();
    initScrollSpy();
    initDocsSearch();
    typeTerminal();

    var year = document.querySelector('[data-year]');
    if (year) year.textContent = String(new Date().getFullYear());
  });
})();
