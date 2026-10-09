import test from 'node:test';
import assert from 'node:assert/strict';
import {rankProducts} from '../src/product-discovery.js';
const products=[{title:'Nike Air Force 1 White',image:'https://example.org/a.png',sourceUrl:'https://example.org/p'}, {title:'Graphic Tee',image:'https://example.org/b.png',sourceUrl:'https://example.org/q'}];
test('exact product keyword ranks first',()=>{const r=rankProducts('Nike Air Force 1 White',products);assert.equal(r[0].title,products[0].title)});
test('generic unknown keyword has no invented reference',()=>{assert.deepEqual(rankProducts('underwater vacuum plush',products),[])});
