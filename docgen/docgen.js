const watch = require('node-watch')
const frontmatter = require('front-matter')

const { resolve } = require('path')
const { readdir, stat } = require('fs').promises
const { mkdirSync, readFile, writeFile, mkdir, unlink } = require('fs')

const marked = require('marked')
const prism = require('prismjs')
const loadCodeLanguages = require('prismjs/components/')
const markedOptions = {
  highlight: function (code, lang) {
    loadCodeLanguages([lang])
		return prism.highlight(code, prism.languages[lang], lang)
	}
}

marked.setOptions(markedOptions)

// Configuration
const config = require('../docgen.config.js')
const contents = {}

const FileHelper = {
  getFilesFromDirectory: async function* (dir) {
    const subdirs = await readdir(dir)
    for (const subdir of subdirs) {
      const res = resolve(dir, subdir)
      if ((await stat(res)).isDirectory()) {
        yield* FileHelper.getFilesFromDirectory(res)
      } else {
        yield res
      }
    }
  },

  getDirectoryPath(file) {
    return file.substring(0, file.lastIndexOf('/')).replace(config.baseDir, config.docgenDir)
  },

  getOutputFilePath(file) {
    return file.replace(config.baseDir, config.docgenDir).replace('.md', '.json')
  },

  getRelativeFilePath(file) {
    return '/' + file.replace(config.originContentDir, '').replace('.md', '').replace(config.docgenDir, '').replace('.json', '').replace('content/', '')
  },

  getLanguageRelativeFilePath(file) {
    return FileHelper.getRelativeFilePath(file).replace(FileHelper.getLanguagePathFromFile(file) + '/', '')
  },

  getLanguagePathFromFile(file) {
    return FileHelper.getRelativeFilePath(file).split('/')[1]
  },

  getLanguageOutputFile(file, language) {
    return file.replace('{lang}', language)
  }
}

const Docgen = {
  init: () => {
    for (let index = 0, max = config.languages.length; index < max; index++) {
      let language = config.languages[index]
      contents[language] = {}
    }

    mkdirSync(config.docgenDir, { recursive: true })
    Docgen.generateAll()
    watch(config.originContentDir, { recursive: true }, Docgen.fileEvent)
  },

  fileEvent: (evt, updatedFile) => {
    if (evt == 'remove') {
      unlink(FileHelper.getOutputFilePath(updatedFile), (err) => {
        if (err) throw err
      })
    } else {
      Docgen.generate(updatedFile)
    }
  },

  updateCollections: (source) => {
    for (let index = 0, max = config.ignoreFiles.length; index < max; index++) {
      if (source.indexOf(config.ignoreFiles[index]) >= 0) {
        return
      }
    }
    
    readFile(source, { encoding: 'utf8' }, (err, data) => {
      let path = FileHelper.getLanguageRelativeFilePath(source)
      let lang = FileHelper.getLanguagePathFromFile(source)
      
      contents[lang][path] = JSON.parse(data)

      for (let index = 0, max = config.languages.length; index < max; index++) {
        let language = config.languages[index]
        
        Docgen.generateCombined(contents, language)
        Docgen.generateMenu(contents, language)
        Docgen.generateOrdered(contents, language)
      }    
    })
  },

  generateCombined: (contents, language) => {
    writeFile(FileHelper.getLanguageOutputFile(config.combinedContentFile, language), JSON.stringify(contents[language]), (err) => {
      if (err) throw err
    })
  },

  generateOrdered: (contents, language) => {
    let ordered = Docgen.orderContents(contents[language])

    writeFile(FileHelper.getLanguageOutputFile(config.orderedContentFile, language), JSON.stringify(ordered, null, 2), (err) => {
      if (err) throw err
    })
  },

  generateMenu: (contents, language) => {
    let ordered = Docgen.orderContents(contents[language])

    let latestStartpage = null
    let categories = {}

    for (let index = 0, max = ordered.length; index < max; index++) {
      const element = JSON.parse(JSON.stringify(ordered[index]));
      delete element.example
      delete element.content
      delete element.origin

      let isChild = false
      // group by startpage
      if (latestStartpage == null) {
        latestStartpage = element
        latestStartpage.children = []
      } else if (typeof element.attributes !== 'undefined' && element.attributes.startpage) {
        latestStartpage = element
        latestStartpage.children = []
      } else {
        isChild = true
        latestStartpage.children.push(element)
      }
      
      // categories
      if (!isChild) { 
        if (typeof categories[element.attributes.category] !== 'undefined') { 
          categories[element.attributes.category].push(element)   
        } else {
          categories[element.attributes.category] = []
          categories[element.attributes.category].push(element)        
        }
      }
    }

    let menu = []
    for (const key in categories) {
      if (categories.hasOwnProperty(key)) {
        const category = categories[key];
        menu.push({ category: key, items: category })
      }
    }

    writeFile(FileHelper.getLanguageOutputFile(config.menuContentFile, language), JSON.stringify(menu, null, 2), (err) => {
      if (err) throw err
    })
  },

  orderContents: (contents) => {
    return Object.values(contents).sort((a, b) => {
      if (a.attributes.position < b.attributes.position) return -1
      if (a.attributes.position > b.attributes.position) return 1
      return 0
    })
  },

  generateAll: () => {
    (async () => {
      for await (const f of FileHelper.getFilesFromDirectory(config.originContentDir)) {
        Docgen.generate(f)
      }
    })()
  },

  stripParagraphWrapper(markdown) { 
    return markdown.replace('<p>', '').replace('</p>\n', '')
  },

  generate: (source) => {
    readFile(source, { encoding: 'utf8' }, (err, originData) => {
      if (err) throw err
  
      let dir = FileHelper.getDirectoryPath(source)
      mkdir(dir, { recursive: true }, (err) => {
  
        let originContent = frontmatter(originData)
        let originDataBody = originContent.body
        let originDataAttributes = originContent.attributes
        
        let area = originDataBody.split(config.splitString)
  
        let content = marked(area[0] || '')
        let example = marked(area[1] || '')
        
        let fullPath = FileHelper.getRelativeFilePath(source)
        let path = FileHelper.getLanguageRelativeFilePath(source)

  
        let data = {
          fullPath: fullPath,
          path: path,
          attributes: originDataAttributes,
          content: content,
          example: example
        }
  
        if (typeof originDataAttributes.title !== 'undefined') {
          data.title = Docgen.stripParagraphWrapper(marked(originDataAttributes.title))
        }
        
        let out = FileHelper.getOutputFilePath(source)
        writeFile(out, JSON.stringify(data), (err) => {
          if (err) throw err
          Docgen.updateCollections(out)
        })
      })
    })
  }
}

Docgen.init()