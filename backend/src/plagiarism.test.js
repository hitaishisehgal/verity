import { describe, expect, test } from '@jest/globals';
import { compare, fingerprints, tokenize } from './services/plagiarism/similarity.js';

describe('similarity detector', () => {
  test('removes comments and normalizes string literals', () => {
    expect(tokenize('int value = 2; // note')).toEqual(tokenize('int value = 2; /* other */'));
    expect(tokenize('print("alpha")')).toEqual(tokenize("print('beta')"));
    expect(tokenize('print("http://host/#fragment") # comment')).toEqual(tokenize("print('different') # other"));
  });
  test('identical code has maximal similarity', () => {
    const source='public class Main { int sum(int a,int b){ return a+b; } }';
    expect(compare(source,source).similarity).toBe(100);
  });
  test('small edits retain measurable similarity below exact matches', () => {
    const original='public class Main { int sum(int a,int b){ int result=a+b; return result; } }';
    const changed='public class Main { int sum(int a,int b){ int result=a-b; return result; } }';
    expect(compare(original,changed).similarity).toBeGreaterThan(0);
    expect(compare(original,changed).similarity).toBeLessThan(100);
  });
  test('filters matching starter fingerprints before comparing students', () => {
    const template='public class Main { public static void main ( String [ ] args ) { System . out . println ( "starter" ) ; } }';
    const common='public static int calculate ( int value ) { int result = value * 7 + 4 ; return result ; }';
    const sourceA=template+' '+common+' int extraA = 1 ; int extraB = 2 ; int extraC = 3 ;';
    const sourceB=template+' '+common+' int uniqueX = 8 ; int uniqueY = 9 ; int uniqueZ = 10 ;';
    const baselineComparison=compare(sourceA,sourceB,template);
    expect(baselineComparison.similarity).toBeLessThan(compare(sourceA,sourceB).similarity);
    expect(baselineComparison.commonTokenSequences.length).toBeGreaterThan(0);
    expect(baselineComparison.commonTokenSequences).not.toContainEqual(expect.arrayContaining(tokenize(template).slice(0,5)));
  });
  test('unrelated implementations score below similar implementations', () => {
    const a='public class Main { int sum(int a,int b){ return a+b; } }';
    const b='def render(items):\\n    for item in items:\\n        print(item.name.upper())';
    expect(compare(a,b).similarity).toBeLessThan(compare(a,a).similarity);
  });
  test('short files and fingerprint selection are safe', () => {
    expect(fingerprints('x=1').size).toBe(0);
    expect(fingerprints('int a=1; int b=2; return a+b;').size).toBeGreaterThan(0);
  });
});