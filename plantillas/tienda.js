// Filtro por categoría de la portada.
const filtros = document.querySelectorAll('.filtro');
const tarjetas = document.querySelectorAll('.tarjeta');
filtros.forEach((boton) => {
  boton.addEventListener('click', () => {
    const cat = boton.dataset.cat;
    filtros.forEach((b) => b.classList.toggle('activo', b === boton));
    tarjetas.forEach((t) => { t.hidden = Boolean(cat) && t.dataset.cat !== cat; });
  });
});
