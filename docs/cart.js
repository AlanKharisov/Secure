// docs/cart.js
(function(){
    const KEY = 'marki.cart.v1';

    function read(){
        try { return JSON.parse(localStorage.getItem(KEY) || '[]'); }
        catch { return []; }
    }
    function save(items){
        localStorage.setItem(KEY, JSON.stringify(items));
        updateBadge();
    }
    function count(){ return read().length; }
    function exists(id){ return read().some(x => Number(x.id) === Number(id)); }
    function add(item){
        const items = read();
        if (!items.some(x => Number(x.id) === Number(item.id))) {
            items.push(item);
            save(items);
        }
    }
    function remove(id){
        const items = read().filter(x => Number(x.id) !== Number(id));
        save(items);
    }
    function clear(){ save([]); }

    function updateBadge(){
        const el = document.getElementById('cartCount');
        if (el) el.textContent = String(count());
    }

    window.MCart = { read, save, add, remove, clear, count, exists, updateBadge };
    document.addEventListener('DOMContentLoaded', updateBadge);
})();