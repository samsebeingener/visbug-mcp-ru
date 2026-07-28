/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 *
 * visbug-mcp-ru — dev-only JSX instrumentation: inject data-visbug-src
 * https://github.com/samsebeingener/visbug-mcp-ru
 */

const path = require('path')

/**
 * @param {{ types: import('@babel/core').types }} api
 */
module.exports = function babelPluginVisbugSrc({ types: t }) {
  return {
    name: 'babel-plugin-visbug-src',
    visitor: {
      JSXOpeningElement(openingPath, state) {
        const opts = state.opts || {}
        if (opts.env !== 'development') return

        const { node } = openingPath
        const name = node.name

        if (t.isJSXIdentifier(name, { name: 'Fragment' })) return
        if (
          t.isJSXMemberExpression(name)
          && t.isJSXIdentifier(name.object, { name: 'React' })
          && t.isJSXIdentifier(name.property, { name: 'Fragment' })
        ) return

        const hasAttr = node.attributes.some(
          (attr) => t.isJSXAttribute(attr)
            && t.isJSXIdentifier(attr.name, { name: 'data-visbug-src' }),
        )
        if (hasAttr) return

        const filename = state.filename
        if (!filename) return

        const loc = node.loc?.start
        if (!loc) return

        const relativeFilename = path.relative(process.cwd(), filename)
        const value = `${relativeFilename}:${loc.line}:${loc.column}`

        node.attributes.push(
          t.jsxAttribute(
            t.jsxIdentifier('data-visbug-src'),
            t.stringLiteral(value),
          ),
        )
      },
    },
  }
}
