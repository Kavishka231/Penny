const themeToggle = document.querySelector('.theme-toggle');
const savedTheme = localStorage.getItem('penny_theme') || 'light';

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('penny_theme', theme);
  if (themeToggle) themeToggle.textContent = theme === 'dark' ? 'Light' : 'Dark';
}

setTheme(savedTheme);

themeToggle?.addEventListener('click', () => {
  setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
});

const siteHeader = document.querySelector('.site-header');
let lastScrollY = window.scrollY;

window.addEventListener('scroll', () => {
  const currentScrollY = window.scrollY;
  const scrollingDown = currentScrollY > lastScrollY;

  if (siteHeader && currentScrollY > 90) {
    siteHeader.classList.toggle('header-hidden', scrollingDown);
  } else {
    siteHeader?.classList.remove('header-hidden');
  }

  lastScrollY = currentScrollY;
}, { passive: true });

// IntersectionObserver watches every reveal element and adds .active as it enters the viewport.
const revealElements = document.querySelectorAll(
  '.reveal, .reveal-left, .reveal-right, .reveal-up, .reveal-scale'
);

// Feature and insight cards receive small staggered delays so they appear one by one.
document.querySelectorAll('.feature-card, .insight-card').forEach((card, index) => {
  card.style.setProperty('--reveal-delay', `${index * 120}ms`);
});

const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add('active');
      revealObserver.unobserve(entry.target);
    }
  });
}, {
  threshold: 0.16,
  rootMargin: '0px 0px -60px 0px'
});

revealElements.forEach((element) => revealObserver.observe(element));
