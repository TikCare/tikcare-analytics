import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./resolve-bare-js.mjs', pathToFileURL('./test/'));
